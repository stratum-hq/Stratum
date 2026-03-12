import { FastifyInstance } from "fastify";
import { Stratum } from "@stratum/lib";

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
  };
}
