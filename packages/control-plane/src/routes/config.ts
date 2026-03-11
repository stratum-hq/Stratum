import { FastifyInstance } from "fastify";
import { SetConfigInputSchema } from "@stratum/core";
import { Stratum } from "@stratum/lib";

export function createConfigRoutes(stratum: Stratum) {
  return async function configRoutes(app: FastifyInstance): Promise<void> {
    // GET /api/v1/tenants/:id/config — Get resolved config
    app.get<{ Params: { id: string } }>("/", async (request, reply) => {
      const resolved = await stratum.resolveConfig(request.params.id);
      reply.status(200).send(resolved);
    });

    // PUT /api/v1/tenants/:id/config/:key — Set config value
    app.put<{ Params: { id: string; key: string } }>("/:key", async (request, reply) => {
      const input = SetConfigInputSchema.parse(request.body);
      const entry = await stratum.setConfig(request.params.id, request.params.key, input);
      reply.status(200).send(entry);
    });

    // DELETE /api/v1/tenants/:id/config/:key — Delete config override
    app.delete<{ Params: { id: string; key: string } }>("/:key", async (request, reply) => {
      await stratum.deleteConfig(request.params.id, request.params.key);
      reply.status(204).send();
    });

    // GET /api/v1/tenants/:id/config/inheritance — Get full inheritance view
    app.get<{ Params: { id: string } }>("/inheritance", async (request, reply) => {
      const inheritance = await stratum.getConfigWithInheritance(request.params.id);
      reply.status(200).send(inheritance);
    });
  };
}
