import { FastifyInstance } from "fastify";
import { Stratum } from "@stratum-hq/lib";
import { createTenantScopeGuard, fromParamId } from "../middleware/tenant-scope.js";

export function createAbacRoutes(stratum: Stratum) {
  return async function abacRoutes(app: FastifyInstance): Promise<void> {
    // Tenant-scoped keys can only access ABAC policies for their own tenant subtree
    app.addHook("preHandler", createTenantScopeGuard(stratum, fromParamId));

    // POST /api/v1/tenants/:tenantId/abac-policies — Create ABAC policy
    app.post<{ Params: { tenantId: string } }>("/", async (request, reply) => {
      const policy = await stratum.createAbacPolicy(
        request.params.tenantId,
        request.body as Parameters<typeof stratum.createAbacPolicy>[1],
      );
      reply.status(201).send(policy);
    });

    // GET /api/v1/tenants/:tenantId/abac-policies — List own ABAC policies
    app.get<{ Params: { tenantId: string } }>("/", async (request, reply) => {
      const policies = await stratum.getAbacPolicies(request.params.tenantId);
      reply.status(200).send(policies);
    });

    // POST /api/v1/tenants/:tenantId/abac/evaluate — Evaluate an ABAC request
    app.post<{ Params: { tenantId: string } }>("/evaluate", async (request, reply) => {
      const result = await stratum.evaluateAbac(
        request.params.tenantId,
        request.body as Parameters<typeof stratum.evaluateAbac>[1],
      );
      reply.status(200).send(result);
    });

    // DELETE /api/v1/tenants/:tenantId/abac-policies/:policyId — Delete ABAC policy
    app.delete<{ Params: { tenantId: string; policyId: string } }>(
      "/:policyId",
      async (request, reply) => {
        await stratum.deleteAbacPolicy(
          request.params.tenantId,
          request.params.policyId,
        );
        reply.status(204).send();
      },
    );
  };
}
