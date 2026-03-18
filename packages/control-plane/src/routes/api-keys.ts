import { FastifyInstance } from "fastify";
import { Stratum } from "@stratum-hq/lib";
import { z } from "zod";
import { createTenantScopeGuard, fromBodyTenantId, fromQueryTenantId } from "../middleware/tenant-scope.js";

const createApiKeySchema = z.object({
  tenant_id: z.string().uuid(),
  name: z.string().optional(),
  rate_limit_max: z.number().int().min(1).max(100_000).optional(),
  rate_limit_window: z.string().regex(/^\d+\s+(second|minute|hour|day)s?$/i).optional(),
});

export function createApiKeyRoutes(stratum: Stratum) {
  return async function apiKeyRoutes(app: FastifyInstance): Promise<void> {
    // POST /api/v1/api-keys — Create a new API key (plaintext returned once)
    app.post<{ Body: { tenant_id: string; name?: string } }>(
      "/",
      { preHandler: createTenantScopeGuard(stratum, fromBodyTenantId) },
      async (request, reply) => {
        const parsed = createApiKeySchema.safeParse(request.body);
        if (!parsed.success) {
          reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid request body" }, details: parsed.error.issues });
          return;
        }
        const { tenant_id, name, rate_limit_max, rate_limit_window } = parsed.data;
        const result = await stratum.createApiKey(tenant_id, {
          name,
          rateLimitMax: rate_limit_max,
          rateLimitWindow: rate_limit_window,
        });
        reply.status(201).send(result);
      },
    );

    // GET /api/v1/api-keys — List API keys (optional ?tenant_id=)
    app.get<{ Querystring: { tenant_id?: string } }>("/", async (request, reply) => {
      // Scoped keys can only list keys for their own tenant
      const tenantId = request.apiKey?.tenant_id ?? request.query.tenant_id;
      const keys = await stratum.listApiKeys(tenantId);
      reply.status(200).send(keys);
    });

    // GET /api/v1/api-keys/dormant — List dormant API keys (must be before /:id)
    app.get<{ Querystring: { days?: string } }>("/dormant", async (request, reply) => {
      const raw = request.query.days ? parseInt(request.query.days, 10) : 90;
      const days = Number.isNaN(raw) || raw < 1 ? 90 : Math.min(raw, 365);
      const keys = await stratum.listDormantKeys(days);
      reply.status(200).send(keys);
    });

    // POST /api/v1/api-keys/:id/rotate — Rotate an API key
    app.post<{ Params: { id: string } }>("/:id/rotate", async (request, reply) => {
      // Verify caller has access to this key's tenant
      if (request.apiKey?.tenant_id) {
        const keys = await stratum.listApiKeys(request.apiKey.tenant_id);
        if (!keys.some(k => k.id === request.params.id)) {
          reply.status(404).send({ error: { code: "NOT_FOUND", message: "API key not found or already revoked" } });
          return;
        }
      }
      const rotateSchema = z.object({ name: z.string().max(255).optional() });
      const parsed = rotateSchema.parse(request.body ?? {});
      const result = await stratum.rotateApiKey(request.params.id, parsed.name);
      reply.status(201).send(result);
    });

    // DELETE /api/v1/api-keys/:id — Revoke an API key
    app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
      // Verify caller has access to this key's tenant
      if (request.apiKey?.tenant_id) {
        const keys = await stratum.listApiKeys(request.apiKey.tenant_id);
        if (!keys.some(k => k.id === request.params.id)) {
          reply.status(404).send({ error: { code: "NOT_FOUND", message: "API key not found or already revoked" } });
          return;
        }
      }
      const revoked = await stratum.revokeApiKey(request.params.id);
      if (!revoked) {
        reply.status(404).send({ error: { code: "NOT_FOUND", message: "API key not found or already revoked" } });
        return;
      }
      reply.status(204).send();
    });
  };
}
