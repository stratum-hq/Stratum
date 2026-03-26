import { FastifyInstance, FastifyRequest } from "fastify";
import { CreateWebhookInputSchema, UpdateWebhookInputSchema, ForbiddenError } from "@stratum-hq/core";
import { Stratum } from "@stratum-hq/lib";
import { buildAuditContext } from "./audit-logs.js";
import { createTenantScopeGuard, fromBodyTenantId } from "../middleware/tenant-scope.js";

/**
 * Post-fetch tenant access check for webhook routes.
 * Used after loading a webhook by ID to verify the caller's key
 * has access to the webhook's tenant.
 *
 * - Global keys (tenant_id = null) have unrestricted access.
 * - Global webhooks (tenant_id = null) are only accessible to global-scope keys.
 * - Scoped keys may access webhooks belonging to their tenant or any descendant.
 */
async function assertTenantAccess(
  request: FastifyRequest,
  webhookTenantId: string | null,
  stratum: Stratum,
): Promise<void> {
  const apiKey = request.apiKey;
  if (!apiKey) return;

  // Global key: unrestricted access
  if (apiKey.tenant_id === null) return;

  // Scoped key cannot access global webhooks
  if (webhookTenantId === null) {
    throw new ForbiddenError("API key does not have access to this webhook's tenant");
  }

  // Fast path: exact match
  if (apiKey.tenant_id === webhookTenantId) return;

  // Hierarchy check: webhook's tenant must be a descendant of the key's tenant
  try {
    const target = await stratum.getTenant(webhookTenantId);
    const ancestorIds = target.ancestry_path.split("/").filter(Boolean);
    if (ancestorIds.includes(apiKey.tenant_id)) return;
  } catch {
    // Tenant not found — fail closed for scoped keys
    throw new ForbiddenError("API key does not have access to this webhook's tenant");
  }

  throw new ForbiddenError("API key does not have access to this webhook's tenant");
}

export function createWebhookRoutes(stratum: Stratum) {
  return async function webhookRoutes(app: FastifyInstance): Promise<void> {
    // Tenant-scoped keys can only access webhooks for their own tenant subtree.
    // This guard covers the POST / (create) route where tenant_id is in the body.
    app.addHook("preHandler", createTenantScopeGuard(stratum, fromBodyTenantId));

    // POST /api/v1/webhooks — Create webhook
    app.post("/", async (request, reply) => {
      const input = CreateWebhookInputSchema.parse(request.body);
      // Scoped keys cannot create global webhooks
      if (request.apiKey?.tenant_id !== null && input.tenant_id === null) {
        throw new ForbiddenError("API key does not have access to create global webhooks");
      }
      const webhook = await stratum.createWebhook(input, buildAuditContext(request));
      reply.status(201).send(webhook);
    });

    // GET /api/v1/webhooks — List webhooks (optional ?tenant_id=)
    app.get<{ Querystring: { tenant_id?: string } }>("/", async (request, reply) => {
      const scopedTenantId = request.apiKey?.tenant_id;

      if (scopedTenantId) {
        // Scoped keys: list webhooks for their tenant and all descendants
        const descendants = await stratum.getDescendants(scopedTenantId);
        const allowedIds = new Set([scopedTenantId, ...descendants.map((d) => d.id)]);
        const queryTenantId = request.query.tenant_id;

        // If caller filtered by a specific tenant, ensure it's in the allowed set
        const fetchTenantId = queryTenantId ?? scopedTenantId;
        if (!allowedIds.has(fetchTenantId)) {
          throw new ForbiddenError("API key does not have access to this tenant's webhooks");
        }

        const webhooks = await stratum.listWebhooks(fetchTenantId);
        // Exclude global webhooks from scoped key responses
        reply.status(200).send(webhooks.filter((w) => w.tenant_id !== null));
      } else {
        // Global key: return all (or filtered by query param)
        const webhooks = await stratum.listWebhooks(request.query.tenant_id);
        reply.status(200).send(webhooks);
      }
    });

    // GET /api/v1/webhooks/:id — Get webhook
    app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
      const webhook = await stratum.getWebhook(request.params.id);
      await assertTenantAccess(request, webhook.tenant_id, stratum);
      reply.status(200).send(webhook);
    });

    // PATCH /api/v1/webhooks/:id — Update webhook
    app.patch<{ Params: { id: string } }>("/:id", async (request, reply) => {
      const existing = await stratum.getWebhook(request.params.id);
      await assertTenantAccess(request, existing.tenant_id, stratum);
      const input = UpdateWebhookInputSchema.parse(request.body);
      const webhook = await stratum.updateWebhook(request.params.id, input, buildAuditContext(request));
      reply.status(200).send(webhook);
    });

    // DELETE /api/v1/webhooks/:id — Delete webhook
    app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
      const existing = await stratum.getWebhook(request.params.id);
      await assertTenantAccess(request, existing.tenant_id, stratum);
      await stratum.deleteWebhook(request.params.id, buildAuditContext(request));
      reply.status(204).send();
    });

    // GET /api/v1/webhooks/:id/deliveries — List deliveries for a webhook
    app.get<{ Params: { id: string } }>("/:id/deliveries", async (request, reply) => {
      const webhook = await stratum.getWebhook(request.params.id);
      await assertTenantAccess(request, webhook.tenant_id, stratum);
      const deliveries = await stratum.listWebhookDeliveries(request.params.id);
      reply.status(200).send(deliveries);
    });

    // POST /api/v1/webhooks/:id/test — Send test event
    app.post<{ Params: { id: string } }>("/:id/test", async (request, reply) => {
      const webhook = await stratum.getWebhook(request.params.id);
      await assertTenantAccess(request, webhook.tenant_id, stratum);
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
        if (!failed.some((d) => d.id === request.params.deliveryId)) {
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
