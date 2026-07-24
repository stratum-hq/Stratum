import { describe, it, expect, beforeEach, vi } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import type { Stratum } from "@stratum-hq/lib";
import { errorHandler } from "../middleware/error-handler.js";
import { createAuthMiddleware } from "../middleware/auth.js";
import { createAuthorizeMiddleware } from "../middleware/authorize.js";
import {
  createTenantScopeEnforcer,
  declareTenantScope,
} from "../middleware/tenant-scope.js";
import { healthRoutes } from "../routes/health.js";
import { createTenantRoutes } from "../routes/tenants.js";
import { createConfigRoutes } from "../routes/config.js";
import { createPermissionRoutes } from "../routes/permissions.js";
import { createApiKeyRoutes } from "../routes/api-keys.js";
import { createWebhookRoutes } from "../routes/webhooks.js";
import { createAuditLogRoutes } from "../routes/audit-logs.js";
import { createConsentRoutes } from "../routes/consent.js";
import { createRoleRoutes } from "../routes/roles.js";
import { createConfigDiffRoutes } from "../routes/config-diff.js";
import { createAbacRoutes } from "../routes/abac.js";
import { createMockStratum } from "./test-helpers.js";

/**
 * Cross-tenant deny matrix — an executable proof of the Stratum tenant boundary.
 *
 * This is not a collection of ad-hoc regressions. It is a single data-driven
 * matrix over the real control-plane authorization chain (auth -> authorize ->
 * tenant-scope enforcer), one cell per boundary crossing. Each cell drives the
 * genuine middleware and route handlers with a WRONG-tenant credential and
 * asserts the denial the contract requires (403, or 404 where a route masks a
 * cross-tenant resource as not-found, or 401 where authentication itself is
 * absent). A handful of ALLOW cells hold the boundary honest: they prove the
 * enforcer does not over-block a caller acting inside its own subtree, and that
 * scoped reads are pinned to the caller's own tenant.
 *
 * PROOF, not fix: if any DENY cell returns success, the boundary is broken.
 * The assertion stays; the finding is triaged. Do not weaken a cell to go green.
 *
 * The tenant tree under test (ancestry_path holds ANCESTORS only, root = ""):
 *
 *   A  (MSP root)                 B  (MSP root)
 *   |- A1                         |- B1
 *   |  |- A11
 *   |- A2  (sibling of A1)
 *
 * A scoped key may reach its own tenant and its descendants, nothing else.
 */

const A = "11111111-1111-4111-8111-111111111111";
const A1 = "22222222-2222-4222-8222-222222222222";
const A11 = "33333333-3333-4333-8333-333333333333";
const A2 = "44444444-4444-4444-8444-444444444444";
const B = "99999999-9999-4999-8999-999999999999";
const B1 = "88888888-8888-4888-8888-888888888888";

// A tenant's ANCESTORS, "/"-joined, excluding self. A root is "".
const ANCESTRY: Record<string, string> = {
  [A]: "",
  [A1]: A,
  [A11]: `${A}/${A1}`,
  [A2]: A,
  [B]: "",
  [B1]: B,
};

// getDescendants results per tenant (active descendants, excluding self).
const DESCENDANTS: Record<string, string[]> = {
  [A]: [A1, A11, A2],
  [A1]: [A11],
  [A11]: [],
  [A2]: [],
  [B]: [B1],
  [B1]: [],
};

// Foreign-owned resources used by in-handler (post-fetch) boundary checks.
const ROLE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROLE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const WEBHOOK_B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const AUDIT_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

// --- Actor credentials, keyed by the X-API-Key header value they present. ---
type KeyRecord = {
  key_id: string;
  tenant_id: string | null;
  scopes: string[];
  rate_limit_max: number | null;
  rate_limit_window: string | null;
};

const KEY_A = "key-A"; // scoped to A, full scopes
const KEY_A1 = "key-A1"; // scoped to A1, full scopes
const KEY_A_READ = "key-A-read"; // scoped to A, read only
const KEY_A_WRITE = "key-A-write"; // scoped to A, read+write
const KEY_GLOBAL = "key-global"; // operator, tenant_id null
const KEY_INVALID = "key-invalid"; // not accepted by validateApiKey

function cred(tenant_id: string | null, scopes: string[]): KeyRecord {
  return {
    key_id: `id-${tenant_id ?? "global"}`,
    tenant_id,
    scopes,
    rate_limit_max: null,
    rate_limit_window: null,
  };
}

const KEYS: Record<string, KeyRecord> = {
  [KEY_A]: cred(A, ["read", "write", "admin"]),
  [KEY_A1]: cred(A1, ["read", "write", "admin"]),
  [KEY_A_READ]: cred(A, ["read"]),
  [KEY_A_WRITE]: cred(A, ["read", "write"]),
  [KEY_GLOBAL]: cred(null, ["read", "write", "admin"]),
};

// The full method surface these routes call. createMockStratum stubs many of
// these already; the rest are attached below. Accessing them as a name->mock
// map keeps the wiring and assertions typed without `any`.
const METHODS = [
  "getTenant",
  "getDescendants",
  "listTenants",
  "createTenant",
  "updateTenant",
  "deleteTenant",
  "batchCreateTenants",
  "moveTenant",
  "reorderTenant",
  "getAncestors",
  "getChildren",
  "purgeTenant",
  "exportTenantData",
  "migrateRegion",
  "getTenantContext",
  "resolveConfig",
  "setConfig",
  "deleteConfig",
  "batchSetConfig",
  "getConfigWithInheritance",
  "diffConfig",
  "resolvePermissions",
  "createPermission",
  "updatePermission",
  "deletePermission",
  "createAbacPolicy",
  "getAbacPolicies",
  "evaluateAbac",
  "deleteAbacPolicy",
  "createApiKey",
  "validateApiKey",
  "revokeApiKey",
  "rotateApiKey",
  "listApiKeys",
  "getApiKey",
  "listDormantKeys",
  "createRole",
  "getRole",
  "listRoles",
  "updateRole",
  "deleteRole",
  "assignRoleToKey",
  "removeRoleFromKey",
  "createWebhook",
  "getWebhook",
  "listWebhooks",
  "updateWebhook",
  "deleteWebhook",
  "listWebhookDeliveries",
  "testWebhook",
  "getDeliveryStats",
  "listFailedDeliveries",
  "retryFailedDeliveries",
  "retryDelivery",
  "queryAuditLogs",
  "getAuditEntry",
  "grantConsent",
  "listConsent",
  "revokeConsent",
] as const;

type MockMap = Record<string, ReturnType<typeof vi.fn>>;

/** Fresh mock Stratum with every method a vi.fn(), wired to the fixture tree. */
function wireStratum(): { stratum: Stratum; m: MockMap } {
  const stratum = createMockStratum();
  const m = stratum as unknown as MockMap;
  for (const name of METHODS) m[name] = vi.fn();

  m.validateApiKey.mockImplementation(async (key: string) => KEYS[key] ?? null);

  m.getTenant.mockImplementation(async (id: string) => {
    const ancestry_path = ANCESTRY[id];
    if (ancestry_path === undefined) throw new Error(`Tenant ${id} not found`);
    return { id, ancestry_path, status: "active", slug: `t-${id.slice(0, 4)}` };
  });
  m.getDescendants.mockImplementation(async (id: string) =>
    (DESCENDANTS[id] ?? []).map((d) => ({ id: d, ancestry_path: ANCESTRY[d] })),
  );

  // Resolvers used by allow-cells (return shape only has to be serializable).
  m.resolveConfig.mockResolvedValue({});
  m.resolvePermissions.mockResolvedValue({});
  m.getTenantContext.mockImplementation(async (id: string) => ({
    tenant: { id },
  }));
  m.getConfigWithInheritance.mockResolvedValue({});
  m.diffConfig.mockResolvedValue({ added: {}, removed: {}, changed: {} });
  m.getAncestors.mockResolvedValue([]);
  m.listTenants.mockResolvedValue({ data: [], next_cursor: null, has_more: false });

  // Mutations return minimal valid-looking payloads so allow-cells reach 2xx.
  m.createTenant.mockResolvedValue({
    id: "created",
    slug: "newco",
    isolation_strategy: "SHARED_RLS",
  });
  m.moveTenant.mockImplementation(async (id: string) => ({ id }));
  m.updateTenant.mockImplementation(async (id: string) => ({ id }));
  m.setConfig.mockResolvedValue({ key: "k", value: 1 });

  // Roles.
  const ROLES: Record<string, { id: string; tenant_id: string | null }> = {
    [ROLE_A]: { id: ROLE_A, tenant_id: A },
    [ROLE_B]: { id: ROLE_B, tenant_id: B },
  };
  m.getRole.mockImplementation(async (id: string) => ROLES[id] ?? null);
  m.listRoles.mockResolvedValue([]);
  m.updateRole.mockImplementation(async (id: string) => ROLES[id] ?? null);
  m.deleteRole.mockResolvedValue(true);
  m.createRole.mockResolvedValue({ id: "new-role", tenant_id: A });

  // Webhooks.
  m.getWebhook.mockImplementation(async (id: string) => ({
    id,
    tenant_id: id === WEBHOOK_B ? B : A,
  }));
  m.listWebhooks.mockResolvedValue([]);
  m.createWebhook.mockResolvedValue({ id: "wh", tenant_id: A });

  // Audit.
  m.queryAuditLogs.mockResolvedValue([]);
  m.getAuditEntry.mockImplementation(async (id: string) => ({
    id,
    tenant_id: id === AUDIT_B ? B : A,
  }));

  // API keys.
  m.createApiKey.mockResolvedValue({ id: "k", key: "sk_x" });
  m.listApiKeys.mockResolvedValue([]);

  return { stratum, m };
}

/**
 * Build a Fastify app wired exactly like the production control plane: the same
 * three preHandlers in the same order, the same error handler, and EVERY tenant
 * route plugin registered under its real prefix. Two synthetic routes exercise
 * the default-deny enforcer directly.
 */
async function buildApp(stratum: Stratum): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.addHook("preHandler", createAuthMiddleware(stratum));
  app.addHook("preHandler", createAuthorizeMiddleware());
  app.addHook("preHandler", createTenantScopeEnforcer(stratum));
  app.setErrorHandler(errorHandler);

  const noopRedisHealth = async () => "not_configured" as const;
  await app.register(healthRoutes(noopRedisHealth));
  await app.register(createTenantRoutes(stratum), { prefix: "/api/v1/tenants" });
  await app.register(createConfigRoutes(stratum), {
    prefix: "/api/v1/tenants/:id/config",
  });
  await app.register(createPermissionRoutes(stratum), {
    prefix: "/api/v1/tenants/:id/permissions",
  });
  await app.register(createApiKeyRoutes(stratum), { prefix: "/api/v1/api-keys" });
  await app.register(createWebhookRoutes(stratum), { prefix: "/api/v1/webhooks" });
  await app.register(createAuditLogRoutes(stratum), {
    prefix: "/api/v1/audit-logs",
  });
  await app.register(createConsentRoutes(stratum), {
    prefix: "/api/v1/tenants/:tenantId/consent",
  });
  await app.register(createRoleRoutes(stratum), { prefix: "/api/v1/roles" });
  await app.register(createConfigDiffRoutes(stratum), { prefix: "/api/v1/config" });
  await app.register(createAbacRoutes(stratum), {
    prefix: "/api/v1/tenants/:tenantId/abac-policies",
  });

  // Synthetic route with NO tenant-scope declaration: the default-deny enforcer
  // must refuse it. Registered directly on the app, so no plugin's
  // declareTenantScope hook stamps a declaration onto it.
  app.get("/api/v1/undeclared/:id", async (_req, reply) =>
    reply.status(200).send({ reached: true }),
  );
  // Synthetic route explicitly declared "global": must be admitted.
  await app.register(async (scoped) => {
    declareTenantScope(scoped, "global");
    scoped.get("/api/v1/opsonly", async (_req, reply) =>
      reply.status(200).send({ ok: true }),
    );
  });

  await app.ready();
  return app;
}

// --- The matrix. Every cell is one boundary crossing, one assertion. ---

type Boundary = 1 | 2 | 3 | 4 | 5;

interface Cell {
  id: string;
  boundary: Boundary;
  desc: string;
  actor?: string; // X-API-Key header value; omit for an unauthenticated call
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  url: string;
  body?: unknown;
  expect: "deny" | "allow";
  status?: number; // exact status: deny defaults to 403, allow asserts < 400
  guarded?: string; // on deny: NOT called; on allow: called
  guardedWith?: unknown[]; // on allow: called with these args
}

const MATRIX: Cell[] = [
  // ================= Boundary 1: MSP-to-MSP (root A key -> root B) ==========
  {
    id: "b1-read-config",
    boundary: 1,
    desc: "A key cannot read B's resolved config",
    actor: KEY_A,
    method: "GET",
    url: `/api/v1/tenants/${B}/config`,
    expect: "deny",
    guarded: "resolveConfig",
  },
  {
    id: "b1-write-config",
    boundary: 1,
    desc: "A key cannot set a config value on B",
    actor: KEY_A,
    method: "PUT",
    url: `/api/v1/tenants/${B}/config/feature_flag`,
    body: { value: true },
    expect: "deny",
    guarded: "setConfig",
  },
  {
    id: "b1-mutate-tenant",
    boundary: 1,
    desc: "A key cannot mutate B's tenant record",
    actor: KEY_A,
    method: "PATCH",
    url: `/api/v1/tenants/${B}`,
    body: { name: "hijacked" },
    expect: "deny",
    guarded: "updateTenant",
  },
  {
    id: "b1-delete-tenant",
    boundary: 1,
    desc: "A key cannot archive B",
    actor: KEY_A,
    method: "DELETE",
    url: `/api/v1/tenants/${B}`,
    expect: "deny",
    guarded: "deleteTenant",
  },
  {
    id: "b1-read-foreign-role",
    boundary: 1,
    desc: "A key cannot read a role owned by B",
    actor: KEY_A,
    method: "GET",
    url: `/api/v1/roles/${ROLE_B}`,
    expect: "deny",
  },
  {
    id: "b1-mutate-foreign-role",
    boundary: 1,
    desc: "A key cannot update a role owned by B",
    actor: KEY_A,
    method: "PATCH",
    url: `/api/v1/roles/${ROLE_B}`,
    body: { name: "hijacked" },
    expect: "deny",
    guarded: "updateRole",
  },
  {
    id: "b1-create-foreign-webhook",
    boundary: 1,
    desc: "A key cannot create a webhook owned by B",
    actor: KEY_A,
    method: "POST",
    url: `/api/v1/webhooks`,
    body: { tenant_id: B, url: "https://x", events: ["tenant.created"] },
    expect: "deny",
    guarded: "createWebhook",
  },
  {
    id: "b1-read-foreign-webhook",
    boundary: 1,
    desc: "A key cannot read a webhook owned by B",
    actor: KEY_A,
    method: "GET",
    url: `/api/v1/webhooks/${WEBHOOK_B}`,
    expect: "deny",
  },
  {
    id: "b1-read-foreign-audit",
    boundary: 1,
    desc: "A key sees B's audit entry as not-found (masked)",
    actor: KEY_A,
    method: "GET",
    url: `/api/v1/audit-logs/${AUDIT_B}`,
    expect: "deny",
    status: 404,
  },
  {
    id: "b1-create-foreign-apikey",
    boundary: 1,
    desc: "A key cannot mint an API key for B",
    actor: KEY_A,
    method: "POST",
    url: `/api/v1/api-keys`,
    body: { tenant_id: B },
    expect: "deny",
    guarded: "createApiKey",
  },
  {
    id: "b1-diff-foreign",
    boundary: 1,
    desc: "A key cannot diff its config against B",
    actor: KEY_A,
    method: "GET",
    url: `/api/v1/config/diff?tenant_a=${A}&tenant_b=${B}`,
    expect: "deny",
    guarded: "diffConfig",
  },
  {
    id: "b1-diff-foreign-first",
    boundary: 1,
    desc: "A key cannot diff with B as the first operand",
    actor: KEY_A,
    method: "GET",
    url: `/api/v1/config/diff?tenant_a=${B}&tenant_b=${A}`,
    expect: "deny",
    guarded: "diffConfig",
  },

  // ================= Boundary 2: parent/child/sibling within a subtree ======
  {
    id: "b2-child-cannot-reach-parent",
    boundary: 2,
    desc: "A1 key cannot read its parent A's config (no upward reach)",
    actor: KEY_A1,
    method: "GET",
    url: `/api/v1/tenants/${A}/config`,
    expect: "deny",
    guarded: "resolveConfig",
  },
  {
    id: "b2-child-cannot-reach-sibling",
    boundary: 2,
    desc: "A1 key cannot mutate its sibling A2",
    actor: KEY_A1,
    method: "PATCH",
    url: `/api/v1/tenants/${A2}`,
    body: { name: "x" },
    expect: "deny",
    guarded: "updateTenant",
  },
  {
    id: "b2-child-cannot-reach-unrelated-root",
    boundary: 2,
    desc: "A1 key cannot read unrelated root B's config",
    actor: KEY_A1,
    method: "GET",
    url: `/api/v1/tenants/${B}/config`,
    expect: "deny",
    guarded: "resolveConfig",
  },
  {
    id: "b2-descendants-boundary-webhooks",
    boundary: 2,
    desc: "A1 key cannot list webhooks of sibling A2 (getDescendants boundary)",
    actor: KEY_A1,
    method: "GET",
    url: `/api/v1/webhooks?tenant_id=${A2}`,
    expect: "deny",
    guarded: "listWebhooks",
  },
  {
    id: "b2-own-descendant-allowed",
    boundary: 2,
    desc: "A1 key CAN read its own descendant A11's config (not over-blocked)",
    actor: KEY_A1,
    method: "GET",
    url: `/api/v1/tenants/${A11}/config`,
    expect: "allow",
    guarded: "resolveConfig",
  },
  {
    id: "b2-own-descendant-webhooks-allowed",
    boundary: 2,
    desc: "A1 key CAN list its descendant A11's webhooks",
    actor: KEY_A1,
    method: "GET",
    url: `/api/v1/webhooks?tenant_id=${A11}`,
    expect: "allow",
    guarded: "listWebhooks",
    guardedWith: [A11],
  },

  // ================= Boundary 3: scope escalation ===========================
  {
    id: "b3-read-key-to-admin-route",
    boundary: 3,
    desc: "read-scope key is refused on an admin route (own tenant)",
    actor: KEY_A_READ,
    method: "GET",
    url: `/api/v1/tenants/${A}/context`,
    expect: "deny",
    guarded: "getTenantContext",
  },
  {
    id: "b3-read-key-to-admin-route-qs",
    boundary: 3,
    desc: "read-scope key stays refused on an admin route with a query string (#110)",
    actor: KEY_A_READ,
    method: "GET",
    url: `/api/v1/tenants/${A}/context?probe=1`,
    expect: "deny",
    guarded: "getTenantContext",
  },
  {
    id: "b3-write-key-to-admin-route",
    boundary: 3,
    desc: "write-scope key is refused on an admin route (purge)",
    actor: KEY_A_WRITE,
    method: "POST",
    url: `/api/v1/tenants/${A}/purge`,
    expect: "deny",
    guarded: "purgeTenant",
  },
  {
    id: "b3-write-key-to-admin-route-qs",
    boundary: 3,
    desc: "write-scope key stays refused on an admin route with a query string (#110)",
    actor: KEY_A_WRITE,
    method: "POST",
    url: `/api/v1/tenants/${A}/purge?probe=1`,
    expect: "deny",
    guarded: "purgeTenant",
  },
  {
    id: "b3-read-key-to-admin-apikeys",
    boundary: 3,
    desc: "read-scope key is refused on the admin-only api-keys list",
    actor: KEY_A_READ,
    method: "GET",
    url: `/api/v1/api-keys`,
    expect: "deny",
    guarded: "listApiKeys",
  },
  {
    id: "b3-read-key-to-admin-audit",
    boundary: 3,
    desc: "read-scope key is refused on the admin-only audit-logs list",
    actor: KEY_A_READ,
    method: "GET",
    url: `/api/v1/audit-logs`,
    expect: "deny",
    guarded: "queryAuditLogs",
  },
  {
    id: "b3-read-key-to-write-op",
    boundary: 3,
    desc: "read-scope key cannot perform a write on its own tenant",
    actor: KEY_A_READ,
    method: "PATCH",
    url: `/api/v1/tenants/${A}`,
    body: { name: "x" },
    expect: "deny",
    guarded: "updateTenant",
  },
  {
    id: "b3-scoped-create-root",
    boundary: 3,
    desc: "scoped key cannot create a new root tenant (#2 class)",
    actor: KEY_A,
    method: "POST",
    url: `/api/v1/tenants`,
    body: { slug: "rootco", name: "Root Co" },
    expect: "deny",
    guarded: "createTenant",
  },
  {
    id: "b3-scoped-create-under-foreign",
    boundary: 3,
    desc: "scoped key cannot create a tenant under a foreign parent",
    actor: KEY_A,
    method: "POST",
    url: `/api/v1/tenants`,
    body: { slug: "newco", name: "New Co", parent_id: B },
    expect: "deny",
    guarded: "createTenant",
  },
  {
    id: "b3-scoped-graft-under-foreign",
    boundary: 3,
    desc: "scoped key cannot graft its tenant under a foreign parent (moveTenant #2 class)",
    actor: KEY_A,
    method: "POST",
    url: `/api/v1/tenants/${A}/move`,
    body: { new_parent_id: B },
    expect: "deny",
    guarded: "moveTenant",
  },
  {
    id: "b3-write-key-to-admin-apikey-create",
    boundary: 3,
    desc: "write-scope key cannot mint an API key even for its own tenant (admin route)",
    actor: KEY_A_WRITE,
    method: "POST",
    url: `/api/v1/api-keys`,
    body: { tenant_id: A },
    expect: "deny",
    guarded: "createApiKey",
  },

  // ================= Boundary 4: impersonation / delegated permissions ======
  {
    id: "b4-foreign-context",
    boundary: 4,
    desc: "A key cannot resolve B's impersonation context",
    actor: KEY_A,
    method: "GET",
    url: `/api/v1/tenants/${B}/context`,
    expect: "deny",
    guarded: "getTenantContext",
  },
  {
    id: "b4-foreign-permissions-read",
    boundary: 4,
    desc: "A key cannot read B's resolved permissions (no delegation leak)",
    actor: KEY_A,
    method: "GET",
    url: `/api/v1/tenants/${B}/permissions`,
    expect: "deny",
    guarded: "resolvePermissions",
  },
  {
    id: "b4-foreign-permissions-grant",
    boundary: 4,
    desc: "A key cannot grant a permission on B",
    actor: KEY_A,
    method: "POST",
    url: `/api/v1/tenants/${B}/permissions`,
    body: { key: "feature:beta", mode: "INHERITED" },
    expect: "deny",
    guarded: "createPermission",
  },
  {
    id: "b4-foreign-abac-create",
    boundary: 4,
    desc: "A key cannot create an ABAC policy on B",
    actor: KEY_A,
    method: "POST",
    url: `/api/v1/tenants/${B}/abac-policies`,
    body: { name: "x", resource_type: "r", action: "read", effect: "allow", conditions: [] },
    expect: "deny",
    guarded: "createAbacPolicy",
  },
  {
    id: "b4-foreign-abac-list",
    boundary: 4,
    desc: "A key cannot list B's ABAC policies",
    actor: KEY_A,
    method: "GET",
    url: `/api/v1/tenants/${B}/abac-policies`,
    expect: "deny",
    guarded: "getAbacPolicies",
  },
  {
    id: "b4-foreign-abac-evaluate",
    boundary: 4,
    desc: "A key cannot evaluate ABAC against B",
    actor: KEY_A,
    method: "POST",
    url: `/api/v1/tenants/${B}/abac-policies/evaluate`,
    body: { subject: {}, resource: {}, action: "read" },
    expect: "deny",
    guarded: "evaluateAbac",
  },
  {
    id: "b4-foreign-consent",
    boundary: 4,
    desc: "A key cannot list B's consent records",
    actor: KEY_A,
    method: "GET",
    url: `/api/v1/tenants/${B}/consent`,
    expect: "deny",
    guarded: "listConsent",
  },

  // ================= Boundary 5: default-deny / authentication ==============
  {
    id: "b5-undeclared-route",
    boundary: 5,
    desc: "a route declaring no tenant scope is refused (#107 class)",
    actor: KEY_A,
    method: "GET",
    url: `/api/v1/undeclared/${A}`,
    expect: "deny",
  },
  {
    id: "b5-missing-credential",
    boundary: 5,
    desc: "an unauthenticated request is refused",
    method: "GET",
    url: `/api/v1/tenants/${A}`,
    expect: "deny",
    status: 401,
  },
  {
    id: "b5-invalid-credential",
    boundary: 5,
    desc: "an invalid API key is refused",
    actor: KEY_INVALID,
    method: "GET",
    url: `/api/v1/tenants/${A}`,
    expect: "deny",
    status: 401,
  },

  // ================= ALLOW controls: the boundary must not over-block =======
  {
    id: "allow-own-config",
    boundary: 1,
    desc: "A key CAN read its own config",
    actor: KEY_A,
    method: "GET",
    url: `/api/v1/tenants/${A}/config`,
    expect: "allow",
    guarded: "resolveConfig",
  },
  {
    id: "allow-read-key-own-read",
    boundary: 3,
    desc: "read-scope key CAN read its own config",
    actor: KEY_A_READ,
    method: "GET",
    url: `/api/v1/tenants/${A}/config`,
    expect: "allow",
    guarded: "resolveConfig",
  },
  {
    id: "allow-admin-own-context",
    boundary: 3,
    desc: "admin key CAN resolve its own impersonation context",
    actor: KEY_A,
    method: "GET",
    url: `/api/v1/tenants/${A}/context`,
    expect: "allow",
    guarded: "getTenantContext",
  },
  {
    id: "allow-roles-list-pinned",
    boundary: 1,
    desc: "A key listing roles is pinned to tenant A (no enumeration)",
    actor: KEY_A,
    method: "GET",
    url: `/api/v1/roles`,
    expect: "allow",
    guarded: "listRoles",
    guardedWith: [A],
  },
  {
    id: "allow-audit-list-pinned",
    boundary: 1,
    desc: "A key listing audit logs is pinned to tenant A (no enumeration)",
    actor: KEY_A,
    method: "GET",
    url: `/api/v1/audit-logs`,
    expect: "allow",
    guarded: "queryAuditLogs",
    guardedWith: [expect.objectContaining({ tenant_id: A })],
  },
  {
    id: "allow-global-create-root",
    boundary: 3,
    desc: "operator key CAN create a new root tenant",
    actor: KEY_GLOBAL,
    method: "POST",
    url: `/api/v1/tenants`,
    body: { slug: "rootco", name: "Root Co" },
    expect: "allow",
    guarded: "createTenant",
  },
  {
    id: "allow-global-move-anywhere",
    boundary: 3,
    desc: "operator key CAN graft any tenant under any parent",
    actor: KEY_GLOBAL,
    method: "POST",
    url: `/api/v1/tenants/${A}/move`,
    body: { new_parent_id: B },
    expect: "allow",
    guarded: "moveTenant",
  },
  {
    id: "allow-global-diff-anywhere",
    boundary: 1,
    desc: "operator key CAN diff any two tenants",
    actor: KEY_GLOBAL,
    method: "GET",
    url: `/api/v1/config/diff?tenant_a=${A}&tenant_b=${B}`,
    expect: "allow",
    guarded: "diffConfig",
    guardedWith: [A, B],
  },
  {
    id: "allow-global-route",
    boundary: 5,
    desc: "a route declared global is admitted",
    actor: KEY_A,
    method: "GET",
    url: `/api/v1/opsonly`,
    expect: "allow",
  },
];

describe("cross-tenant deny matrix", () => {
  let app: FastifyInstance;
  let m: MockMap;

  beforeEach(async () => {
    const wired = wireStratum();
    m = wired.m;
    app = await buildApp(wired.stratum);
  });

  for (const cell of MATRIX) {
    const tag = cell.expect === "deny" ? "DENY" : "allow";
    it(`[B${cell.boundary}][${tag}] ${cell.id}: ${cell.desc}`, async () => {
      const headers: Record<string, string> = {};
      if (cell.actor) headers["x-api-key"] = cell.actor;
      // Only declare a JSON body when one is present: Fastify rejects an empty
      // body under content-type application/json (400) before any preHandler.
      if (cell.body !== undefined) headers["content-type"] = "application/json";

      const res = await app.inject({
        method: cell.method,
        url: cell.url,
        headers,
        payload: cell.body !== undefined ? JSON.stringify(cell.body) : undefined,
      });

      if (cell.expect === "deny") {
        expect(
          res.statusCode,
          `${cell.id} must be denied but returned ${res.statusCode}: ${res.body}`,
        ).toBe(cell.status ?? 403);
        if (cell.guarded) {
          expect(
            m[cell.guarded],
            `${cell.id} denied but still reached ${cell.guarded}`,
          ).not.toHaveBeenCalled();
        }
      } else {
        expect(
          res.statusCode,
          `${cell.id} must be allowed but returned ${res.statusCode}: ${res.body}`,
        ).toBeLessThan(400);
        if (cell.status) expect(res.statusCode).toBe(cell.status);
        if (cell.guarded) {
          if (cell.guardedWith) {
            expect(m[cell.guarded]).toHaveBeenCalledWith(...cell.guardedWith);
          } else {
            expect(m[cell.guarded]).toHaveBeenCalled();
          }
        }
      }
    });
  }

  it("covers every tenant boundary with at least one deny cell", () => {
    const denyByBoundary = new Map<Boundary, number>();
    const allowByBoundary = new Map<Boundary, number>();
    for (const cell of MATRIX) {
      const map = cell.expect === "deny" ? denyByBoundary : allowByBoundary;
      map.set(cell.boundary, (map.get(cell.boundary) ?? 0) + 1);
    }

    const lines = ([1, 2, 3, 4, 5] as Boundary[]).map(
      (b) =>
        `  boundary ${b}: ${denyByBoundary.get(b) ?? 0} deny, ${allowByBoundary.get(b) ?? 0} allow`,
    );
    console.log(
      `\ncross-tenant deny matrix coverage (${MATRIX.length} cells total):\n${lines.join("\n")}`,
    );

    for (const b of [1, 2, 3, 4, 5] as Boundary[]) {
      expect(
        denyByBoundary.get(b) ?? 0,
        `boundary ${b} has no deny cell`,
      ).toBeGreaterThan(0);
    }
  });
});
