import { FastifyInstance } from "fastify";
import { Stratum } from "@stratum/lib";
import { buildAuditContext } from "./audit-logs.js";

export function createMaintenanceRoutes(stratum: Stratum) {
  return async function maintenanceRoutes(app: FastifyInstance): Promise<void> {
    // POST /api/v1/maintenance/purge-expired — Purge expired data
    app.post<{ Querystring: { retention_days?: string } }>("/purge-expired", async (request, reply) => {
      const rawDays = request.query.retention_days
        ? parseInt(request.query.retention_days, 10)
        : undefined;
      const retentionDays = rawDays !== undefined && (Number.isNaN(rawDays) || rawDays < 1)
        ? undefined
        : rawDays !== undefined ? Math.min(rawDays, 3650) : undefined;
      const result = await stratum.purgeExpiredData(retentionDays);
      reply.status(200).send(result);
    });

    // POST /api/v1/maintenance/rotate-encryption-key — Re-encrypt all sensitive data
    app.post("/rotate-encryption-key", async (request, reply) => {
      const body = request.body as { old_key?: string; new_key?: string } | null;
      if (!body?.old_key || !body?.new_key) {
        reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Both 'old_key' and 'new_key' are required" } });
        return;
      }
      if (body.old_key === body.new_key) {
        reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "'new_key' must differ from 'old_key'" } });
        return;
      }
      const result = await stratum.rotateEncryptionKey(body.old_key, body.new_key, buildAuditContext(request));
      reply.status(200).send(result);
    });
  };
}
