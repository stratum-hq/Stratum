import { FastifyInstance } from "fastify";
import {
  CreateTenantInputSchema,
  UpdateTenantInputSchema,
  MoveTenantInputSchema,
  MigrateRegionInputSchema,
  PaginationSchema,
  IsolationStrategyUnsupportedError,
  isSupportedIsolationStrategy,
} from "@stratum-hq/core";
import { Stratum } from "@stratum-hq/lib";
import {
  setupSchemaForTenant,
  setupDatabaseForTenant,
} from "../services/isolation-service.js";
import { buildAuditContext } from "./audit-logs.js";
import { createTenantScopeGuard, fromParamId } from "../middleware/tenant-scope.js";

export function createTenantRoutes(stratum: Stratum) {
  return async function tenantRoutes(app: FastifyInstance): Promise<void> {
    // Tenant-scoped keys can only access their own tenant subtree
    app.addHook("preHandler", createTenantScopeGuard(stratum, fromParamId));
    // GET /api/v1/tenants — List tenants (with cursor pagination)
    app.get("/", async (request, reply) => {
      const scopedTenantId = request.apiKey?.tenant_id;
      if (scopedTenantId) {
        const tenant = await stratum.getTenant(scopedTenantId);
        const descendants = await stratum.getDescendants(scopedTenantId);
        reply.status(200).send({ data: [tenant, ...descendants], next_cursor: null, has_more: false });
        return;
      }
      const query = PaginationSchema.parse(request.query);
      const result = await stratum.listTenants(query);
      reply.status(200).send(result);
    });

    // POST /api/v1/tenants — Create tenant
    app.post("/", async (request, reply) => {
      const parsed = CreateTenantInputSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Validation failed", issues: parsed.error.issues } });
        return;
      }
      const input = parsed.data;

      // Reject unsupported isolation strategies (SHARED_RLS and SCHEMA_PER_TENANT are supported)
      if (input.isolation_strategy && !isSupportedIsolationStrategy(input.isolation_strategy)) {
        throw new IsolationStrategyUnsupportedError(input.isolation_strategy);
      }

      const tenant = await stratum.createTenant(input, buildAuditContext(request));

      // Provision isolation resources based on strategy
      const strategy = tenant.isolation_strategy ?? "SHARED_RLS";
      if (strategy === "SCHEMA_PER_TENANT") {
        await setupSchemaForTenant(tenant.slug);
      } else if (strategy === "DB_PER_TENANT") {
        await setupDatabaseForTenant(tenant.slug);
      }

      reply.status(201).send(tenant);
    });

    // POST /api/v1/tenants/batch — Create multiple tenants atomically
    app.post("/batch", async (request, reply) => {
      const body = request.body as { tenants?: unknown[] };
      if (!Array.isArray(body?.tenants) || body.tenants.length === 0) {
        reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Body must contain a non-empty 'tenants' array" } });
        return;
      }
      if (body.tenants.length > 100) {
        reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Batch limited to 100 tenants" } });
        return;
      }
      const results = body.tenants.map((t) => CreateTenantInputSchema.safeParse(t));
      const failed = results.find((r) => !r.success);
      if (failed && !failed.success) {
        reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Validation failed", issues: failed.error.issues } });
        return;
      }
      const inputs = results.map((r) => (r as { success: true; data: any }).data);
      const result = await stratum.batchCreateTenants(inputs, buildAuditContext(request));
      reply.status(201).send(result);
    });

    // GET /api/v1/tenants/:id — Get tenant
    app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
      const tenant = await stratum.getTenant(request.params.id);
      reply.status(200).send(tenant);
    });

    // PATCH /api/v1/tenants/:id — Update tenant
    app.patch<{ Params: { id: string } }>("/:id", async (request, reply) => {
      const patch = UpdateTenantInputSchema.parse(request.body);
      const tenant = await stratum.updateTenant(request.params.id, patch, buildAuditContext(request));
      reply.status(200).send(tenant);
    });

    // DELETE /api/v1/tenants/:id — Soft-delete (archive) tenant
    app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
      await stratum.deleteTenant(request.params.id, buildAuditContext(request));
      reply.status(204).send();
    });

    // POST /api/v1/tenants/:id/move — Move tenant
    app.post<{ Params: { id: string } }>("/:id/move", async (request, reply) => {
      const input = MoveTenantInputSchema.parse(request.body);
      const tenant = await stratum.moveTenant(request.params.id, input.new_parent_id, buildAuditContext(request));
      reply.status(200).send(tenant);
    });

    // POST /api/v1/tenants/:id/reorder — Reorder tenant among siblings
    app.post<{ Params: { id: string } }>("/:id/reorder", async (request, reply) => {
      const body = request.body as { position: number };
      const position = typeof body?.position === "number" ? body.position : 0;
      const tenant = await stratum.reorderTenant(request.params.id, position, buildAuditContext(request));
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

    // POST /api/v1/tenants/:id/migrate-region — Migrate tenant to a new region
    app.post<{ Params: { id: string } }>("/:id/migrate-region", async (request, reply) => {
      const { region_id } = MigrateRegionInputSchema.parse(request.body);
      await stratum.migrateRegion(request.params.id, region_id, buildAuditContext(request));
      reply.status(200).send({ success: true });
    });

    // POST /api/v1/tenants/:id/purge — GDPR Article 17: hard-delete all tenant data
    app.post<{ Params: { id: string } }>("/:id/purge", async (request, reply) => {
      await stratum.purgeTenant(request.params.id, buildAuditContext(request));
      reply.status(204).send();
    });

    // GET /api/v1/tenants/:id/export — GDPR Article 20: export all tenant data
    app.get<{ Params: { id: string } }>("/:id/export", async (request, reply) => {
      const data = await stratum.exportTenantData(request.params.id);
      reply.status(200).send(data);
    });

    // GET /api/v1/tenants/:id/context — Resolve full tenant impersonation context (admin scope)
    app.get<{ Params: { id: string } }>("/:id/context", async (request, reply) => {
      const context = await stratum.getTenantContext(request.params.id);
      reply.status(200).send(context);
    });
  };
}
