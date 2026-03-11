import { FastifyInstance, FastifyRequest } from "fastify";
import { CreateWebhookInputSchema, UpdateWebhookInputSchema, UnauthorizedError } from "@stratum/core";
import { Stratum } from "@stratum/lib";
import { buildAuditContext } from "./audit-logs.js";

/**
 * Ensures the authenticated API key's tenant scope matches the webhook's tenant.
 * Global API keys (tenant_id = null) can access all webhooks.
 * Tenant-scoped keys can only access webhooks belonging to their tenant.
 */
function assertTenantAccess(request: FastifyRequest, webhookTenantId: string | null): void {
  const apiKey = request.apiKey;
  if (!apiKey) {
    throw new UnauthorizedError("Authentication required");
  }
  // Global keys (no tenant_id) have full access
  if (apiKey.tenant_id === null) return;
  // Tenant-scoped keys must match the webhook's tenant
  if (webhookTenantId !== null && apiKey.tenant_id !== webhookTenantId) {
    throw new UnauthorizedError("API key does not have access to this webhook's tenant");
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
  };
}
