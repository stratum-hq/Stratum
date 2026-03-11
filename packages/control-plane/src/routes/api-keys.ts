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
