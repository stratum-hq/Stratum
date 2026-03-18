import { FastifyInstance } from "fastify";
import { CreateRegionInputSchema, UpdateRegionInputSchema } from "@stratum-hq/core";
import { Stratum } from "@stratum-hq/lib";
import { buildAuditContext } from "./audit-logs.js";

export function createRegionRoutes(stratum: Stratum) {
  return async function regionRoutes(app: FastifyInstance): Promise<void> {
    // POST /api/v1/regions — Create region
    app.post("/", async (request, reply) => {
      const input = CreateRegionInputSchema.parse(request.body);
      const region = await stratum.createRegion(input, buildAuditContext(request));
      reply.status(201).send(region);
    });

    // GET /api/v1/regions — List regions
    app.get("/", async (_request, reply) => {
      const regions = await stratum.listRegions();
      reply.status(200).send(regions);
    });

    // GET /api/v1/regions/:id — Get region by ID
    app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
      const region = await stratum.getRegion(request.params.id);
      reply.status(200).send(region);
    });

    // PATCH /api/v1/regions/:id — Update region
    app.patch<{ Params: { id: string } }>("/:id", async (request, reply) => {
      const input = UpdateRegionInputSchema.parse(request.body);
      const region = await stratum.updateRegion(request.params.id, input, buildAuditContext(request));
      reply.status(200).send(region);
    });

    // DELETE /api/v1/regions/:id — Delete region
    app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
      await stratum.deleteRegion(request.params.id, buildAuditContext(request));
      reply.status(204).send();
    });
  };
}
