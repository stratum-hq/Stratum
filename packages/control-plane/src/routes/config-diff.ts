import { FastifyInstance } from "fastify";
import { Stratum } from "@stratum-hq/lib";

export function createConfigDiffRoutes(stratum: Stratum) {
  return async function configDiffRoutes(app: FastifyInstance): Promise<void> {
    // GET /api/v1/config/diff?tenant_a=UUID&tenant_b=UUID — Compare resolved config between two tenants
    app.get<{ Querystring: { tenant_a: string; tenant_b: string } }>(
      "/diff",
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
