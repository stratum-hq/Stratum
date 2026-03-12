import { FastifyInstance } from "fastify";
import { GrantConsentInputSchema } from "@stratum/core";
import { Stratum } from "@stratum/lib";
import { buildAuditContext } from "./audit-logs.js";
import { createTenantScopeGuard, fromParamTenantId } from "../middleware/tenant-scope.js";

export function createConsentRoutes(stratum: Stratum) {
  return async function consentRoutes(app: FastifyInstance): Promise<void> {
    // Tenant-scoped keys can only access consent for their own tenant subtree
    app.addHook("preHandler", createTenantScopeGuard(stratum, fromParamTenantId));
    // POST /api/v1/tenants/:tenantId/consent — Grant consent
    app.post<{ Params: { tenantId: string } }>("/", async (request, reply) => {
      const { tenantId } = request.params;
      const input = GrantConsentInputSchema.parse(request.body);
      const audit = buildAuditContext(request);
      const record = await stratum.grantConsent(tenantId, input, audit);
      reply.status(201).send(record);
    });

    // GET /api/v1/tenants/:tenantId/consent — List consent records
    app.get<{ Params: { tenantId: string }; Querystring: { subject_id?: string } }>(
      "/",
      async (request, reply) => {
        const { tenantId } = request.params;
        const subjectId = request.query.subject_id;
        const records = await stratum.listConsent(tenantId, subjectId);
        reply.status(200).send(records);
      },
    );

    // DELETE /api/v1/tenants/:tenantId/consent/:purpose — Revoke consent
    app.delete<{ Params: { tenantId: string; purpose: string }; Querystring: { subject_id: string } }>(
      "/:purpose",
      async (request, reply) => {
        const { tenantId, purpose } = request.params;
        const subjectId = request.query.subject_id;
        if (!subjectId) {
          reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "subject_id query parameter is required" } });
          return;
        }
        const audit = buildAuditContext(request);
        const revoked = await stratum.revokeConsent(tenantId, subjectId, purpose, audit);
        if (!revoked) {
          reply.status(404).send({ error: { code: "NOT_FOUND", message: "Consent record not found" } });
          return;
        }
        reply.status(200).send({ success: true });
      },
    );
  };
}
