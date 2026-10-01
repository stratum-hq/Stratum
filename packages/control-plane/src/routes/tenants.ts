import { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  CreateTenantInputSchema,
  UpdateTenantInputSchema,
  MoveTenantInputSchema,
  MigrateRegionInputSchema,
  PaginationSchema,
  IsolationStrategyUnsupportedError,
  isSupportedIsolationStrategy,
  getAncestorIds,
  TenantStatus,
  TenantProvisioningError,
} from "@stratum-hq/core";
import type { ResolvedTenantContext } from "@stratum-hq/core";
import { Stratum } from "@stratum-hq/lib";
import {
  setupSchemaForTenant,
  setupDatabaseForTenant,
  teardownSchemaForTenant,
  teardownDatabaseForTenant,
} from "../services/isolation-service.js";
import { buildAuditContext } from "./audit-logs.js";
import { validationErrorBody } from "../middleware/error-handler.js";
import { createTenantScopeGuard, createTenantCreateGuard, createTenantBatchCreateGuard, declareTenantScope, fromParamId, fromBodyNewParentId } from "../middleware/tenant-scope.js";
import { declareRequiredScope } from "../middleware/authorize.js";

export function createTenantRoutes(stratum: Stratum) {
  // A move must authorize BOTH ends. The plugin-level guard below only covers
  // `:id`, the tenant being moved, which a scoped key already owns and which
  // therefore passes on the fast path. This second guard authorizes the
  // destination parent.
  const destinationScopeGuard = createTenantScopeGuard(stratum, fromBodyNewParentId);
  // A create has no `:id` for the plugin-level guard to check, so it authorizes
  // the requested parent instead: scoped keys may only create inside their own
  // subtree, and may not create new roots.
  const createScopeGuard = createTenantCreateGuard(stratum);
  const batchCreateScopeGuard = createTenantBatchCreateGuard(stratum);

  return async function tenantRoutes(app: FastifyInstance): Promise<void> {
    // Tenant-scoped keys can only access their own tenant subtree
    declareTenantScope(app, fromParamId);
    declareRequiredScope(app, { read: "read", write: "write" });
    // GET /api/v1/tenants: List tenants (with cursor pagination)
    app.get("/", async (request, reply) => {
      const scopedTenantId = request.apiKey?.tenant_id;
      if (scopedTenantId) {
        const tenant = await stratum.getTenant(scopedTenantId);
        const descendants = await stratum.getDescendants(scopedTenantId);
        reply.status(200).send({ data: [tenant, ...descendants], next_cursor: null, has_more: false });
        return;
      }
      const query = PaginationSchema.parse(request.query);
      // Active tenants by default; `?status=` lists pending, suspended or
      // archived ones instead (for example to find a tenant whose storage
      // provisioning failed).
      const { status } = z.object({ status: z.nativeEnum(TenantStatus).optional() }).parse(request.query);
      const result = await stratum.listTenants(query, { status });
      reply.status(200).send(result);
    });

    // POST /api/v1/tenants: Create tenant
    app.post("/", { preHandler: createScopeGuard }, async (request, reply) => {
      const parsed = CreateTenantInputSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400).send(validationErrorBody("Validation failed", parsed.error.issues));
        return;
      }
      const input = parsed.data;

      // Reject unsupported isolation strategies (SHARED_RLS and SCHEMA_PER_TENANT are supported)
      if (input.isolation_strategy && !isSupportedIsolationStrategy(input.isolation_strategy)) {
        throw new IsolationStrategyUnsupportedError(input.isolation_strategy);
      }

      const tenant = await stratum.createTenant(input, buildAuditContext(request));

      // A tenant with its own schema or database is created pending, which
      // blocks every use of it. Provision its storage, then activate it. If
      // provisioning fails the tenant stays pending: purge it to remove it
      // (purging a pending tenant never drops storage), then create it again.
      // If activation fails, the storage is removed here, because purging the
      // pending tenant later will not remove it.
      const strategy = tenant.isolation_strategy ?? "SHARED_RLS";
      if (strategy === "SCHEMA_PER_TENANT" || strategy === "DB_PER_TENANT") {
        try {
          if (strategy === "SCHEMA_PER_TENANT") {
            await setupSchemaForTenant(tenant.slug);
          } else {
            await setupDatabaseForTenant(tenant.slug);
          }
        } catch (err) {
          request.log.error({ err, tenant_id: tenant.id }, "tenant storage provisioning failed; tenant left pending");
          throw new TenantProvisioningError(tenant.id);
        }
        let active;
        try {
          active = await stratum.activateTenant(tenant.id, buildAuditContext(request));
        } catch (err) {
          // An error can arrive after the activation committed, for example
          // when the connection drops. Read the tenant again, and remove the
          // storage only when the tenant is known to be still pending.
          // activateTenant already reads the tenant again after such an error
          // and emits tenant.activated when it finds it active. The route does
          // not emit it, so the event is not sent twice.
          const current = await stratum.getTenant(tenant.id, true).catch(() => undefined);
          if (current?.status === "active") {
            reply.status(201).send(current);
            return;
          }
          if (current?.status !== "pending") throw err;
          request.log.error({ err, tenant_id: tenant.id }, "tenant activation failed; removing its provisioned storage");
          // Provisioning refuses storage that already exists, so this request
          // created the storage and no other tenant's data is in it.
          let storageRemoved = true;
          try {
            if (strategy === "SCHEMA_PER_TENANT") {
              await teardownSchemaForTenant(tenant.slug);
            } else {
              await teardownDatabaseForTenant(tenant.slug);
            }
          } catch (teardownErr) {
            storageRemoved = false;
            request.log.error(
              { err: teardownErr, tenant_id: tenant.id, slug: tenant.slug, strategy },
              "could not remove the storage of a tenant whose activation failed; drop it by hand",
            );
          }
          throw new TenantProvisioningError(tenant.id, { stage: "activation", storageRemoved });
        }
        reply.status(201).send(active);
        return;
      }

      reply.status(201).send(tenant);
    });

    // POST /api/v1/tenants/batch: Create multiple tenants atomically
    app.post("/batch", { preHandler: batchCreateScopeGuard }, async (request, reply) => {
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
        reply.status(400).send(validationErrorBody("Validation failed", failed.error.issues));
        return;
      }
      const inputs = results.map((r) => (r as Extract<typeof r, { success: true }>).data);
      // Batch create does not provision schemas or databases, so it only
      // accepts tenants that need none.
      if (inputs.some((i) => i.isolation_strategy !== "SHARED_RLS")) {
        reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: "Batch create supports only SHARED_RLS tenants; create SCHEMA_PER_TENANT and DB_PER_TENANT tenants individually" } });
        return;
      }
      const result = await stratum.batchCreateTenants(inputs, buildAuditContext(request));
      reply.status(201).send(result);
    });

    // GET /api/v1/tenants/:id: Get tenant
    app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
      const tenant = await stratum.getTenant(request.params.id);
      reply.status(200).send(tenant);
    });

    // PATCH /api/v1/tenants/:id: Update tenant
    app.patch<{ Params: { id: string } }>("/:id", async (request, reply) => {
      const patch = UpdateTenantInputSchema.parse(request.body);
      const tenant = await stratum.updateTenant(request.params.id, patch, buildAuditContext(request));
      reply.status(200).send(tenant);
    });

    // DELETE /api/v1/tenants/:id: Soft-delete (archive) tenant
    // A scoped key reaches its own pending child here, so it gets the state
    // error that archive gives a pending tenant, not a scope error.
    app.delete<{ Params: { id: string } }>("/:id", { config: { tenantScopeIncludesPending: true } }, async (request, reply) => {
      await stratum.deleteTenant(request.params.id, buildAuditContext(request));
      reply.status(204).send();
    });

    // POST /api/v1/tenants/:id/move: Move tenant
    app.post<{ Params: { id: string } }>("/:id/move", { preHandler: destinationScopeGuard }, async (request, reply) => {
      const input = MoveTenantInputSchema.parse(request.body);
      const tenant = await stratum.moveTenant(request.params.id, input.new_parent_id, buildAuditContext(request));
      reply.status(200).send(tenant);
    });

    // POST /api/v1/tenants/:id/reorder: Reorder tenant among siblings
    app.post<{ Params: { id: string } }>("/:id/reorder", async (request, reply) => {
      const body = request.body as { position: number };
      const position = typeof body?.position === "number" ? body.position : 0;
      const tenant = await stratum.reorderTenant(request.params.id, position, buildAuditContext(request));
      reply.status(200).send(tenant);
    });

    // GET /api/v1/tenants/:id/ancestors: Get ancestors
    app.get<{ Params: { id: string } }>("/:id/ancestors", async (request, reply) => {
      const ancestors = await stratum.getAncestors(request.params.id);
      // A tenant-scoped caller gets full rows only for ancestors inside its own
      // subtree; for those above it, only identifying fields.
      const scopedTenantId = request.apiKey?.tenant_id;
      if (scopedTenantId) {
        reply.status(200).send(
          ancestors.map((a) =>
            a.id === scopedTenantId || getAncestorIds(a.ancestry_path).includes(scopedTenantId)
              ? a
              : { id: a.id, parent_id: a.parent_id, name: a.name, slug: a.slug, depth: a.depth },
          ),
        );
        return;
      }
      reply.status(200).send(ancestors);
    });

    // GET /api/v1/tenants/:id/descendants: Get descendants
    app.get<{ Params: { id: string } }>("/:id/descendants", async (request, reply) => {
      const descendants = await stratum.getDescendants(request.params.id);
      reply.status(200).send(descendants);
    });

    // GET /api/v1/tenants/:id/children: Get direct children
    app.get<{ Params: { id: string } }>("/:id/children", async (request, reply) => {
      const children = await stratum.getChildren(request.params.id);
      reply.status(200).send(children);
    });

    // POST /api/v1/tenants/:id/migrate-region: Migrate tenant to a new region
    app.post<{ Params: { id: string } }>("/:id/migrate-region", { config: { requiredScope: "admin" } }, async (request, reply) => {
      const { region_id } = MigrateRegionInputSchema.parse(request.body);
      await stratum.migrateRegion(request.params.id, region_id, buildAuditContext(request));
      reply.status(200).send({ success: true });
    });

    // POST /api/v1/tenants/:id/purge: GDPR Article 17: hard-delete all tenant data
    // A scoped key may purge its own pending child, for example after a failed
    // storage provisioning.
    app.post<{ Params: { id: string } }>("/:id/purge", { config: { tenantScopeIncludesPending: true, requiredScope: "admin" } }, async (request, reply) => {
      await stratum.purgeTenant(request.params.id, buildAuditContext(request));
      reply.status(204).send();
    });

    // GET /api/v1/tenants/:id/export: GDPR Article 20: export all tenant data
    app.get<{ Params: { id: string } }>("/:id/export", { config: { requiredScope: "admin" } }, async (request, reply) => {
      const data = await stratum.exportTenantData(request.params.id);
      reply.status(200).send(data);
    });

    // GET /api/v1/tenants/:id/context: Resolve the flat ResolvedTenantContext.
    // Read scope: the SDK middleware calls this on every request, so an app
    // server needs only a read key for the tenants its key scope reaches.
    app.get<{ Params: { id: string } }>("/:id/context", { config: { requiredScope: "read" } }, async (request, reply) => {
      const { tenant, config, permissions } = await stratum.getTenantContext(request.params.id);
      const context: ResolvedTenantContext = {
        tenant_id: tenant.id,
        ancestry_path: tenant.ancestry_path,
        depth: tenant.depth,
        resolved_config: config,
        resolved_permissions: permissions,
        isolation_strategy: tenant.isolation_strategy,
      };
      reply.status(200).send(context);
    });
  };
}
