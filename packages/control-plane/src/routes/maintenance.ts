import { FastifyInstance } from "fastify";
import { Stratum } from "@stratum-hq/lib";
import { buildAuditContext } from "./audit-logs.js";
import { declareTenantScope } from "../middleware/tenant-scope.js";
import { declareRequiredScope } from "../middleware/authorize.js";

// The format of STRATUM_HKDF_SALT. Buffer.from(salt, "hex") silently shortens any other string.
const HEX_SALT = /^(?:[0-9a-fA-F]{2})+$/;

export function createMaintenanceRoutes(stratum: Stratum) {
  return async function maintenanceRoutes(app: FastifyInstance): Promise<void> {
    // Maintenance acts across all tenants: global operator keys only.
    declareTenantScope(app, "operator");
    declareRequiredScope(app, "operator");

    // POST /api/v1/maintenance/purge-expired — Purge expired data
    app.post<{ Querystring: { retention_days?: string } }>("/purge-expired", async (request, reply) => {
      const rawDays = request.query.retention_days
        ? parseInt(request.query.retention_days, 10)
        : undefined;
      const retentionDays = rawDays !== undefined && (Number.isNaN(rawDays) || rawDays < 1)
        ? undefined
        : rawDays !== undefined ? Math.min(rawDays, 3650) : undefined;
      const result = await stratum.purgeExpiredData(retentionDays, buildAuditContext(request));
      reply.status(200).send(result);
    });

    // POST /api/v1/maintenance/rotate-encryption-key — Re-encrypt all sensitive data
    app.post("/rotate-encryption-key", async (request, reply) => {
      const body = request.body as
        | { old_key?: string; new_key?: string; old_salt?: unknown; new_salt?: unknown }
        | null;
      if (!body?.old_key || !body?.new_key) {
        reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Both 'old_key' and 'new_key' are required" } });
        return;
      }
      for (const field of ["old_salt", "new_salt"] as const) {
        const salt = body[field];
        if (salt !== undefined && (typeof salt !== "string" || !HEX_SALT.test(salt))) {
          reply.status(400).send({
            error: { code: "VALIDATION_ERROR", message: `'${field}' must be a non-empty, even-length hex string` },
          });
          return;
        }
      }
      const oldSalt = body.old_salt as string | undefined;
      const newSalt = body.new_salt as string | undefined;
      // A salt that is not given is the configured salt, so two absent salts are the same salt.
      const sameSalt = oldSalt?.toLowerCase() === newSalt?.toLowerCase();
      if (body.old_key === body.new_key && sameSalt) {
        reply.status(400).send({
          error: { code: "VALIDATION_ERROR", message: "'new_key' must differ from 'old_key' unless 'new_salt' differs from 'old_salt'" },
        });
        return;
      }
      const result = await stratum.rotateEncryptionKey(body.old_key, body.new_key, buildAuditContext(request), {
        oldSalt,
        newSalt,
      });
      reply.status(200).send(result);
    });
  };
}
