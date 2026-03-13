import { FastifyInstance, FastifyRequest } from "fastify";
import { AuditLogQuerySchema } from "@stratum/core";
import type { AuditContext } from "@stratum/core";
import { Stratum } from "@stratum/lib";

export function buildAuditContext(request: FastifyRequest): AuditContext {
  return {
    actor_id: request.apiKey?.id ?? "unknown",
    actor_type: (request.authMethod || "api_key") as "api_key" | "jwt",
    source_ip: request.ip,
    request_id: request.id,
  };
}

export function createAuditLogRoutes(stratum: Stratum) {
  return async function auditLogRoutes(app: FastifyInstance): Promise<void> {
    // GET /api/v1/audit-logs — List audit logs with filters
    app.get("/", async (request, reply) => {
      const query = AuditLogQuerySchema.parse(request.query);
      // Scoped keys can only see logs for their own tenant
      if (request.apiKey?.tenant_id) {
        query.tenant_id = request.apiKey.tenant_id;
      }
      const entries = await stratum.queryAuditLogs(query);
      reply.status(200).send(entries);
    });

    // GET /api/v1/audit-logs/:id — Get single audit entry
    app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
      const entry = await stratum.getAuditEntry(request.params.id);
      if (!entry) {
        reply.status(404).send({ error: { code: "NOT_FOUND", message: "Audit entry not found" } });
        return;
      }
      // Enforce tenant isolation for scoped keys
      if (request.apiKey?.tenant_id && entry.tenant_id !== request.apiKey.tenant_id) {
        reply.status(404).send({ error: { code: "NOT_FOUND", message: "Audit entry not found" } });
        return;
      }
      reply.status(200).send(entry);
    });
  };
}
