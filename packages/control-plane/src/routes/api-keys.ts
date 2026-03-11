import { FastifyInstance } from "fastify";
import { Stratum } from "@stratum/lib";

export function createApiKeyRoutes(stratum: Stratum) {
  return async function apiKeyRoutes(app: FastifyInstance): Promise<void> {
    // POST /api/v1/api-keys — Create a new API key (plaintext returned once)
    app.post<{ Body: { tenant_id: string; name?: string } }>(
      "/",
      async (request, reply) => {
        const { tenant_id, name } = request.body as {
          tenant_id: string;
          name?: string;
        };
        const result = await stratum.createApiKey(tenant_id, name);
        reply.status(201).send(result);
      },
    );

    // GET /api/v1/api-keys — List API keys (optional ?tenant_id=)
    app.get<{ Querystring: { tenant_id?: string } }>("/", async (request, reply) => {
      const keys = await stratum.listApiKeys(request.query.tenant_id);
      reply.status(200).send(keys);
    });

    // GET /api/v1/api-keys/dormant — List dormant API keys (must be before /:id)
    app.get<{ Querystring: { days?: string } }>("/dormant", async (request, reply) => {
      const days = request.query.days ? parseInt(request.query.days, 10) : 90;
      const keys = await stratum.listDormantKeys(days);
      reply.status(200).send(keys);
    });

    // POST /api/v1/api-keys/:id/rotate — Rotate an API key
    app.post<{ Params: { id: string } }>("/:id/rotate", async (request, reply) => {
      const body = request.body as { name?: string } | undefined;
      const result = await stratum.rotateApiKey(request.params.id, (body as { name?: string } | null)?.name);
      reply.status(201).send(result);
    });

    // DELETE /api/v1/api-keys/:id — Revoke an API key
    app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
      const revoked = await stratum.revokeApiKey(request.params.id);
      if (!revoked) {
        reply.status(404).send({ error: "API key not found or already revoked" });
        return;
      }
      reply.status(204).send();
    });
  };
}
