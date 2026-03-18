import { FastifyInstance } from "fastify";
import { SetConfigInputSchema } from "@stratum-hq/core";
import { Stratum } from "@stratum-hq/lib";
import { buildAuditContext } from "./audit-logs.js";
import { createTenantScopeGuard, fromParamId } from "../middleware/tenant-scope.js";

export function createConfigRoutes(stratum: Stratum) {
  return async function configRoutes(app: FastifyInstance): Promise<void> {
    // Tenant-scoped keys can only access config for their own tenant subtree
    app.addHook("preHandler", createTenantScopeGuard(stratum, fromParamId));
    // GET /api/v1/tenants/:id/config — Get resolved config
    app.get<{ Params: { id: string } }>("/", async (request, reply) => {
      const resolved = await stratum.resolveConfig(request.params.id);
      reply.status(200).send(resolved);
    });

    // PUT /api/v1/tenants/:id/config/:key — Set config value
    app.put<{ Params: { id: string; key: string } }>("/:key", async (request, reply) => {
      const input = SetConfigInputSchema.parse(request.body);
      const entry = await stratum.setConfig(request.params.id, request.params.key, input, buildAuditContext(request));
      reply.status(200).send(entry);
    });

    // DELETE /api/v1/tenants/:id/config/:key — Delete config override
    app.delete<{ Params: { id: string; key: string } }>("/:key", async (request, reply) => {
      await stratum.deleteConfig(request.params.id, request.params.key, buildAuditContext(request));
      reply.status(204).send();
    });

    // PUT /api/v1/tenants/:id/config/batch — Set multiple config keys atomically
    app.put<{ Params: { id: string } }>("/batch", async (request, reply) => {
      const body = request.body as { entries?: unknown[] };
      if (!Array.isArray(body?.entries) || body.entries.length === 0) {
        reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Body must contain a non-empty 'entries' array" } });
        return;
      }
      if (body.entries.length > 200) {
        reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Batch limited to 200 entries" } });
        return;
      }
      const entries = body.entries.map((e) => {
        const parsed = SetConfigInputSchema.parse(e);
        const entry = e as Record<string, unknown>;
        return { key: entry.key as string, value: parsed.value, locked: parsed.locked, sensitive: parsed.sensitive };
      });
      const batchResult = await stratum.batchSetConfig(request.params.id, entries, buildAuditContext(request));
      reply.status(200).send(batchResult);
    });

    // GET /api/v1/tenants/:id/config/inheritance — Get full inheritance view
    app.get<{ Params: { id: string } }>("/inheritance", async (request, reply) => {
      const inheritance = await stratum.getConfigWithInheritance(request.params.id);
      reply.status(200).send(inheritance);
    });
  };
}
