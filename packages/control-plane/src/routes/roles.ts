import { FastifyInstance } from "fastify";
import { Stratum } from "@stratum-hq/lib";
import { z } from "zod";
import { buildAuditContext } from "./audit-logs.js";
import {
  assertTenantInScope,
  declareTenantScope,
  fromBodyTenantId,
  fromQueryTenantId,
} from "../middleware/tenant-scope.js";

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
    // Default for this plugin: routes keyed by a role or key id resolve the
    // target tenant in their handler (see assertTenantInScope calls) and so
    // declare "global" to satisfy the default-deny enforcer. Routes whose target
    // tenant IS in the request override this with an extractor below.
    declareTenantScope(app, "global");

    // POST /api/v1/roles — Create a role. A scoped key may create only within
    // its own subtree; the body tenant_id is authorized by the enforcer.
    app.post("/", { config: { tenantScope: fromBodyTenantId } }, async (request, reply) => {
      const parsed = createRoleSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid request body" }, details: parsed.error.issues });
        return;
      }
      const role = await stratum.createRole(parsed.data, buildAuditContext(request));
      reply.status(201).send(role);
    });

    // GET /api/v1/roles — List roles (optional ?tenant_id=). A provided tenant_id
    // is authorized by the enforcer; a scoped key that names none is confined to
    // its own tenant so it cannot enumerate every tenant's roles.
    app.get<{ Querystring: { tenant_id?: string } }>("/", { config: { tenantScope: fromQueryTenantId } }, async (request, reply) => {
      const scopedTenantId = request.apiKey?.tenant_id ?? undefined;
      const tenantId = request.query.tenant_id ?? scopedTenantId;
      const roles = await stratum.listRoles(tenantId);
      reply.status(200).send(roles);
    });

    // GET /api/v1/roles/:id — Get role
    app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
      const role = await stratum.getRole(request.params.id);
      if (!role) {
        reply.status(404).send({ error: { code: "NOT_FOUND", message: "Role not found" } });
        return;
      }
      await assertTenantInScope(stratum, request, role.tenant_id);
      reply.status(200).send(role);
    });

    // PATCH /api/v1/roles/:id — Update role
    app.patch<{ Params: { id: string } }>("/:id", async (request, reply) => {
      const parsed = updateRoleSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Invalid request body" }, details: parsed.error.issues });
        return;
      }
      const existing = await stratum.getRole(request.params.id);
      if (!existing) {
        reply.status(404).send({ error: { code: "NOT_FOUND", message: "Role not found" } });
        return;
      }
      await assertTenantInScope(stratum, request, existing.tenant_id);
      const role = await stratum.updateRole(request.params.id, parsed.data, buildAuditContext(request));
      if (!role) {
        reply.status(404).send({ error: { code: "NOT_FOUND", message: "Role not found" } });
        return;
      }
      reply.status(200).send(role);
    });

    // DELETE /api/v1/roles/:id — Delete role
    app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
      const existing = await stratum.getRole(request.params.id);
      if (!existing) {
        reply.status(404).send({ error: { code: "NOT_FOUND", message: "Role not found" } });
        return;
      }
      await assertTenantInScope(stratum, request, existing.tenant_id);
      const deleted = await stratum.deleteRole(request.params.id, buildAuditContext(request));
      if (!deleted) {
        reply.status(404).send({ error: { code: "NOT_FOUND", message: "Role not found" } });
        return;
      }
      reply.status(204).send();
    });

    // POST /api/v1/roles/assign/:keyId — Assign role to API key. Both the target
    // key and the role must belong to the caller's subtree.
    app.post<{ Params: { keyId: string } }>("/assign/:keyId", async (request, reply) => {
      const parsed = assignRoleSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "role_id is required" } });
        return;
      }
      const key = await stratum.getApiKey(request.params.keyId);
      if (!key) {
        reply.status(404).send({ error: { code: "NOT_FOUND", message: "API key not found" } });
        return;
      }
      await assertTenantInScope(stratum, request, key.tenant_id);
      const role = await stratum.getRole(parsed.data.role_id);
      if (!role) {
        reply.status(404).send({ error: { code: "NOT_FOUND", message: "Role not found" } });
        return;
      }
      await assertTenantInScope(stratum, request, role.tenant_id);
      const success = await stratum.assignRoleToKey(request.params.keyId, parsed.data.role_id);
      if (!success) {
        reply.status(404).send({ error: { code: "NOT_FOUND", message: "API key not found or already revoked" } });
        return;
      }
      reply.status(200).send({ success: true });
    });

    // DELETE /api/v1/roles/assign/:keyId — Remove role from API key
    app.delete<{ Params: { keyId: string } }>("/assign/:keyId", async (request, reply) => {
      const key = await stratum.getApiKey(request.params.keyId);
      if (!key) {
        reply.status(404).send({ error: { code: "NOT_FOUND", message: "API key not found" } });
        return;
      }
      await assertTenantInScope(stratum, request, key.tenant_id);
      const success = await stratum.removeRoleFromKey(request.params.keyId);
      if (!success) {
        reply.status(404).send({ error: { code: "NOT_FOUND", message: "API key not found or already revoked" } });
        return;
      }
      reply.status(200).send({ success: true });
    });
  };
}
