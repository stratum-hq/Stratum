import { FastifyInstance, FastifyRequest } from "fastify";
import { CreateWebhookInputSchema, UpdateWebhookInputSchema, ForbiddenError } from "@stratum/core";
import { Stratum } from "@stratum/lib";
import { buildAuditContext } from "./audit-logs.js";

/**
 * Post-fetch tenant access check for webhook routes.
 * Used after loading a webhook by ID to verify the caller's key
 * has access to the webhook's tenant.
 * Global keys (tenant_id = null) have unrestricted access.
 */
function assertTenantAccess(request: FastifyRequest, webhookTenantId: string | null): void {
  const apiKey = request.apiKey;
  if (!apiKey || apiKey.tenant_id === null) return;
  if (webhookTenantId !== null && apiKey.tenant_id !== webhookTenantId) {
    throw new ForbiddenError("API key does not have access to this webhook's tenant");
  }
}

export function createWebhookRoutes(stratum: Stratum) {
  return async function webhookRoutes(app: FastifyInstance): Promise<void> {
    // POST /api/v1/webhooks — Create webhook
    app.post("/", async (request, reply) => {
      const input = CreateWebhookInputSchema.parse(request.body);
      // Tenant-scoped keys can only create webhooks for their own tenant
      if (request.apiKey?.tenant_id !== null && input.tenant_id !== null) {
        assertTenantAccess(request, input.tenant_id);
      }
      const webhook = await stratum.createWebhook(input, buildAuditContext(request));
      reply.status(201).send(webhook);
    });

    // GET /api/v1/webhooks — List webhooks (optional ?tenant_id=)
    app.get<{ Querystring: { tenant_id?: string } }>("/", async (request, reply) => {
      // Tenant-scoped keys can only list their own tenant's webhooks
      const tenantId = request.apiKey?.tenant_id ?? request.query.tenant_id;
      const webhooks = await stratum.listWebhooks(tenantId);
      reply.status(200).send(webhooks);
    });

    // GET /api/v1/webhooks/:id — Get webhook
    app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
      const webhook = await stratum.getWebhook(request.params.id);
      assertTenantAccess(request, webhook.tenant_id);
      reply.status(200).send(webhook);
    });

    // PATCH /api/v1/webhooks/:id — Update webhook
    app.patch<{ Params: { id: string } }>("/:id", async (request, reply) => {
      const existing = await stratum.getWebhook(request.params.id);
      assertTenantAccess(request, existing.tenant_id);
      const input = UpdateWebhookInputSchema.parse(request.body);
      const webhook = await stratum.updateWebhook(request.params.id, input, buildAuditContext(request));
      reply.status(200).send(webhook);
    });

    // DELETE /api/v1/webhooks/:id — Delete webhook
    app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
      const existing = await stratum.getWebhook(request.params.id);
      assertTenantAccess(request, existing.tenant_id);
      await stratum.deleteWebhook(request.params.id, buildAuditContext(request));
      reply.status(204).send();
    });

    // GET /api/v1/webhooks/:id/deliveries — List deliveries for a webhook
    app.get<{ Params: { id: string } }>("/:id/deliveries", async (request, reply) => {
      const webhook = await stratum.getWebhook(request.params.id);
      assertTenantAccess(request, webhook.tenant_id);
      const deliveries = await stratum.listWebhookDeliveries(request.params.id);
      reply.status(200).send(deliveries);
    });

    // POST /api/v1/webhooks/:id/test — Send test event
    app.post<{ Params: { id: string } }>("/:id/test", async (request, reply) => {
      const webhook = await stratum.getWebhook(request.params.id);
      assertTenantAccess(request, webhook.tenant_id);
      const result = await stratum.testWebhook(request.params.id);
      reply.status(200).send(result);
    });

    // --- Dead-Letter Queue / Delivery Dashboard ---

    // GET /api/v1/webhooks/deliveries/stats — Delivery statistics
    app.get("/deliveries/stats", async (request, reply) => {
      // Scoped keys: restrict to their tenant's deliveries
      const tenantId = request.apiKey?.tenant_id ?? undefined;
      const stats = await stratum.getDeliveryStats(tenantId);
      reply.status(200).send(stats);
    });

    // GET /api/v1/webhooks/deliveries/failed — List failed deliveries (DLQ)
    app.get<{ Querystring: { limit?: string } }>("/deliveries/failed", async (request, reply) => {
      const rawLimit = request.query.limit ? parseInt(request.query.limit, 10) : 100;
      const limit = Number.isNaN(rawLimit) || rawLimit < 1 ? 100 : Math.min(rawLimit, 500);
      const tenantId = request.apiKey?.tenant_id ?? undefined;
      const failed = await stratum.listFailedDeliveries(limit, tenantId);
      reply.status(200).send(failed);
    });

    // POST /api/v1/webhooks/deliveries/retry-all — Retry all failed deliveries
    app.post("/deliveries/retry-all", async (request, reply) => {
      const tenantId = request.apiKey?.tenant_id ?? undefined;
      const count = await stratum.retryFailedDeliveries(tenantId);
      reply.status(200).send({ retried: count });
    });

    // POST /api/v1/webhooks/deliveries/:deliveryId/retry — Retry single delivery
    app.post<{ Params: { deliveryId: string } }>("/deliveries/:deliveryId/retry", async (request, reply) => {
      // Verify tenant access for scoped keys
      if (request.apiKey?.tenant_id) {
        const failed = await stratum.listFailedDeliveries(1000, request.apiKey.tenant_id);
        if (!failed.some((d: { id: string }) => d.id === request.params.deliveryId)) {
          reply.status(404).send({ error: { code: "NOT_FOUND", message: "Delivery not found or not in failed state" } });
          return;
        }
      }
      const success = await stratum.retryDelivery(request.params.deliveryId);
      if (!success) {
        reply.status(404).send({ error: { code: "NOT_FOUND", message: "Delivery not found or not in failed state" } });
        return;
      }
      reply.status(200).send({ success: true });
    });
  };
}
