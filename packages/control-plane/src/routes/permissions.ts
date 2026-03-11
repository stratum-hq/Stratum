import { FastifyInstance } from "fastify";
import { CreatePermissionInputSchema, UpdatePermissionInputSchema } from "@stratum/core";
import { Stratum } from "@stratum/lib";
import { buildAuditContext } from "./audit-logs.js";

export function createPermissionRoutes(stratum: Stratum) {
  return async function permissionRoutes(app: FastifyInstance): Promise<void> {
    // GET /api/v1/tenants/:id/permissions — Get resolved permissions
    app.get<{ Params: { id: string } }>("/", async (request, reply) => {
      const resolved = await stratum.resolvePermissions(request.params.id);
      reply.status(200).send(resolved);
    });

    // POST /api/v1/tenants/:id/permissions — Create permission policy
    app.post<{ Params: { id: string } }>("/", async (request, reply) => {
      const input = CreatePermissionInputSchema.parse(request.body);
      const policy = await stratum.createPermission(request.params.id, input, buildAuditContext(request));
      reply.status(201).send(policy);
    });

    // PATCH /api/v1/tenants/:id/permissions/:policyId — Update permission policy
    app.patch<{ Params: { id: string; policyId: string } }>("/:policyId", async (request, reply) => {
      const input = UpdatePermissionInputSchema.parse(request.body);
      const policy = await stratum.updatePermission(
        request.params.id,
        request.params.policyId,
        input,
        buildAuditContext(request),
      );
      reply.status(200).send(policy);
    });

    // DELETE /api/v1/tenants/:id/permissions/:policyId — Delete/revoke permission policy
    app.delete<{ Params: { id: string; policyId: string } }>("/:policyId", async (request, reply) => {
      await stratum.deletePermission(request.params.id, request.params.policyId, buildAuditContext(request));
      reply.status(204).send();
    });
  };
}
