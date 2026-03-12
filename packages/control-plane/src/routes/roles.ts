import { FastifyInstance } from "fastify";
import { Stratum } from "@stratum/lib";
import { z } from "zod";
import { buildAuditContext } from "./audit-logs.js";

const createRoleSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  scopes: z.array(z.enum(["read", "write", "admin"])).min(1),
  tenant_id: z.string().uuid().optional().nullable(),
});

const updateRoleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  scopes: z.array(z.enum(["read", "write", "admin"])).min(1).optional(),
});

const assignRoleSchema = z.object({
  role_id: z.string().uuid(),
});

export function createRoleRoutes(stratum: Stratum) {
  return async function roleRoutes(app: FastifyInstance): Promise<void> {
    // POST /api/v1/roles — Create a role
    app.post("/", async (request, reply) => {
      const parsed = createRoleSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid request body" }, details: parsed.error.issues });
        return;
      }
      const role = await stratum.createRole(parsed.data, buildAuditContext(request));
      reply.status(201).send(role);
    });

    // GET /api/v1/roles — List roles (optional ?tenant_id=)
    app.get<{ Querystring: { tenant_id?: string } }>("/", async (request, reply) => {
      const roles = await stratum.listRoles(request.query.tenant_id);
      reply.status(200).send(roles);
    });

    // GET /api/v1/roles/:id — Get role
    app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
      const role = await stratum.getRole(request.params.id);
      if (!role) {
        reply.status(404).send({ error: { code: "NOT_FOUND", message: "Role not found" } });
        return;
      }
      reply.status(200).send(role);
    });

    // PATCH /api/v1/roles/:id — Update role
    app.patch<{ Params: { id: string } }>("/:id", async (request, reply) => {
      const parsed = updateRoleSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid request body" }, details: parsed.error.issues });
        return;
      }
      const role = await stratum.updateRole(request.params.id, parsed.data, buildAuditContext(request));
      if (!role) {
        reply.status(404).send({ error: { code: "NOT_FOUND", message: "Role not found" } });
        return;
      }
      reply.status(200).send(role);
    });

    // DELETE /api/v1/roles/:id — Delete role
    app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
      const deleted = await stratum.deleteRole(request.params.id, buildAuditContext(request));
      if (!deleted) {
        reply.status(404).send({ error: { code: "NOT_FOUND", message: "Role not found" } });
        return;
      }
      reply.status(204).send();
    });

    // POST /api/v1/roles/assign/:keyId — Assign role to API key
    app.post<{ Params: { keyId: string } }>("/assign/:keyId", async (request, reply) => {
      const parsed = assignRoleSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "role_id is required" } });
        return;
      }
      const success = await stratum.assignRoleToKey(request.params.keyId, parsed.data.role_id);
      if (!success) {
        reply.status(404).send({ error: { code: "NOT_FOUND", message: "API key not found or already revoked" } });
        return;
      }
      reply.status(200).send({ success: true });
    });

    // DELETE /api/v1/roles/assign/:keyId — Remove role from API key
    app.delete<{ Params: { keyId: string } }>("/assign/:keyId", async (request, reply) => {
      const success = await stratum.removeRoleFromKey(request.params.keyId);
      if (!success) {
        reply.status(404).send({ error: { code: "NOT_FOUND", message: "API key not found or already revoked" } });
        return;
      }
      reply.status(200).send({ success: true });
    });
  };
}
