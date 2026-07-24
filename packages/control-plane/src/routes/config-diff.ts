import { FastifyInstance } from "fastify";
import { Stratum } from "@stratum-hq/lib";
import {
  createTenantScopeGuard,
  declareTenantScope,
  fromQueryTenantA,
  fromQueryTenantB,
} from "../middleware/tenant-scope.js";

export function createConfigDiffRoutes(stratum: Stratum) {
  // The diff compares two tenants read from the query string, so both operands
  // must be authorized against the caller's subtree. The scope declaration below
  // covers `tenant_a`; this second guard covers `tenant_b`.
  const secondOperandGuard = createTenantScopeGuard(stratum, fromQueryTenantB);

  return async function configDiffRoutes(app: FastifyInstance): Promise<void> {
    // A scoped key may diff only within its own subtree; a global key, anywhere.
    declareTenantScope(app, fromQueryTenantA);

    // GET /api/v1/config/diff?tenant_a=UUID&tenant_b=UUID — Compare resolved config between two tenants
    app.get<{ Querystring: { tenant_a: string; tenant_b: string } }>(
      "/diff",
      { preHandler: secondOperandGuard },
      async (request, reply) => {
        const { tenant_a, tenant_b } = request.query;

        if (!tenant_a || !tenant_b) {
          reply.status(400).send({
            error: {
              code: "VALIDATION_ERROR",
              message: "Both tenant_a and tenant_b query parameters are required",
            },
          });
          return;
        }

        if (tenant_a === tenant_b) {
          reply.status(400).send({
            error: {
              code: "VALIDATION_ERROR",
              message: "tenant_a and tenant_b must be different",
            },
          });
          return;
        }

        const diff = await stratum.diffConfig(tenant_a, tenant_b);
        reply.status(200).send(diff);
      },
    );
  };
}
