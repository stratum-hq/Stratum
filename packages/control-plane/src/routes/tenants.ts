import { FastifyInstance } from "fastify";
import {
  CreateTenantInputSchema,
  UpdateTenantInputSchema,
  MoveTenantInputSchema,
  PaginationSchema,
  IsolationStrategyUnsupportedError,
  isSupportedIsolationStrategy,
} from "@stratum/core";
import { Stratum } from "@stratum/lib";

export function createTenantRoutes(stratum: Stratum) {
  return async function tenantRoutes(app: FastifyInstance): Promise<void> {
    // GET /api/v1/tenants — List tenants (with cursor pagination)
    app.get("/", async (request, reply) => {
      const query = PaginationSchema.parse(request.query);
      const result = await stratum.listTenants(query);
      reply.status(200).send(result);
    });

    // POST /api/v1/tenants — Create tenant
    app.post("/", async (request, reply) => {
      const input = CreateTenantInputSchema.parse(request.body);

      // Reject non-SHARED_RLS isolation strategies
      if (input.isolation_strategy && !isSupportedIsolationStrategy(input.isolation_strategy)) {
        throw new IsolationStrategyUnsupportedError(input.isolation_strategy);
      }

      const tenant = await stratum.createTenant(input);
      reply.status(201).send(tenant);
    });

    // GET /api/v1/tenants/:id — Get tenant
    app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
      const tenant = await stratum.getTenant(request.params.id);
      reply.status(200).send(tenant);
    });

    // PATCH /api/v1/tenants/:id — Update tenant
    app.patch<{ Params: { id: string } }>("/:id", async (request, reply) => {
      const patch = UpdateTenantInputSchema.parse(request.body);
      const tenant = await stratum.updateTenant(request.params.id, patch);
      reply.status(200).send(tenant);
    });

    // DELETE /api/v1/tenants/:id — Soft-delete (archive) tenant
    app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
      await stratum.deleteTenant(request.params.id);
      reply.status(204).send();
    });

    // POST /api/v1/tenants/:id/move — Move tenant
    app.post<{ Params: { id: string } }>("/:id/move", async (request, reply) => {
      const input = MoveTenantInputSchema.parse(request.body);
      const tenant = await stratum.moveTenant(request.params.id, input.new_parent_id);
      reply.status(200).send(tenant);
    });

    // GET /api/v1/tenants/:id/ancestors — Get ancestors
    app.get<{ Params: { id: string } }>("/:id/ancestors", async (request, reply) => {
      const ancestors = await stratum.getAncestors(request.params.id);
      reply.status(200).send(ancestors);
    });

    // GET /api/v1/tenants/:id/descendants — Get descendants
    app.get<{ Params: { id: string } }>("/:id/descendants", async (request, reply) => {
      const descendants = await stratum.getDescendants(request.params.id);
      reply.status(200).send(descendants);
    });

    // GET /api/v1/tenants/:id/children — Get direct children
    app.get<{ Params: { id: string } }>("/:id/children", async (request, reply) => {
      const children = await stratum.getChildren(request.params.id);
      reply.status(200).send(children);
    });

    // GET /api/v1/tenants/:id/context — Resolve full tenant context
    app.get<{ Params: { id: string } }>("/:id/context", async (request, reply) => {
      const tenant = await stratum.getTenant(request.params.id);
      const [config, permissions] = await Promise.all([
        stratum.resolveConfig(request.params.id),
        stratum.resolvePermissions(request.params.id),
      ]);
      reply.status(200).send({
        tenant_id: tenant.id,
        ancestry_path: tenant.ancestry_path,
        depth: tenant.depth,
        isolation_strategy: tenant.isolation_strategy,
        resolved_config: config,
        resolved_permissions: permissions,
      });
    });
  };
}
