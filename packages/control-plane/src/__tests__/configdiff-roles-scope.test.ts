import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Stratum } from "@stratum-hq/lib";
import { createMockStratum, buildTestApp, authHeaders } from "./test-helpers.js";

/**
 * Regression tests for cross-tenant authorization on the config-diff and role
 * administration routes.
 *
 * Both route groups were declared "global" for the default-deny enforcer, which
 * is behavior-preserving but performs no per-tenant check. That left a
 * tenant-scoped API key able to reach tenants outside its own subtree:
 *  - config diff compares two tenants read from the query string;
 *  - role routes read/mutate roles owned by an arbitrary tenant.
 *
 * A scoped key must be confined to its own tenant and descendants. Global
 * operator keys (tenant_id === null) keep unrestricted access.
 */

const ATTACKER = "11111111-1111-4111-8111-111111111111";
const ATTACKER_CHILD = "22222222-2222-4222-8222-222222222222";
const VICTIM = "99999999-9999-4999-8999-999999999999";

type Row = { id: string; ancestry_path: string; status: string };

// ancestry_path holds a tenant's ANCESTORS and excludes self, so a root is "".
const TENANTS: Record<string, Row> = {
  [ATTACKER]: { id: ATTACKER, ancestry_path: "", status: "active" },
  [ATTACKER_CHILD]: { id: ATTACKER_CHILD, ancestry_path: ATTACKER, status: "active" },
  [VICTIM]: { id: VICTIM, ancestry_path: "", status: "active" },
};

const ROLE_OWN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROLE_FOREIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ROLE_GLOBAL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

type RoleRow = { id: string; name: string; description: null; scopes: string[]; tenant_id: string | null };

const ROLES: Record<string, RoleRow> = {
  [ROLE_OWN]: { id: ROLE_OWN, name: "own", description: null, scopes: ["read"], tenant_id: ATTACKER },
  [ROLE_FOREIGN]: { id: ROLE_FOREIGN, name: "foreign", description: null, scopes: ["read"], tenant_id: VICTIM },
  [ROLE_GLOBAL]: { id: ROLE_GLOBAL, name: "global", description: null, scopes: ["read"], tenant_id: null },
};

const OWN_KEY = "own-key-id";
const FOREIGN_KEY = "foreign-key-id";

const KEYS: Record<string, { id: string; tenant_id: string | null }> = {
  [OWN_KEY]: { id: OWN_KEY, tenant_id: ATTACKER },
  [FOREIGN_KEY]: { id: FOREIGN_KEY, tenant_id: VICTIM },
};

let app: FastifyInstance;
let stratum: Stratum;

function wireCommonMocks(): void {
  (stratum.getTenant as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) => {
    const row = TENANTS[id];
    if (!row) throw new Error(`Tenant ${id} not found`);
    return row;
  });
  (stratum.diffConfig as ReturnType<typeof vi.fn>).mockResolvedValue({ added: {}, removed: {}, changed: {} });
  (stratum.getRole as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) => ROLES[id] ?? null);
  // Without a tenant filter, listing returns every tenant's roles: this is the leak.
  (stratum.listRoles as ReturnType<typeof vi.fn>).mockImplementation(async (tenantId?: string) => {
    const all = Object.values(ROLES);
    if (!tenantId) return all;
    return all.filter((r) => r.tenant_id === tenantId || r.tenant_id === null);
  });
  (stratum.createRole as ReturnType<typeof vi.fn>).mockImplementation(async (input) => ({
    id: "new-role",
    description: null,
    ...input,
  }));
  (stratum.updateRole as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) => ROLES[id] ?? null);
  (stratum.deleteRole as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  (stratum.assignRoleToKey as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  (stratum.removeRoleFromKey as ReturnType<typeof vi.fn>).mockResolvedValue(true);
  (stratum.getApiKey as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) => KEYS[id] ?? null);
}

async function diff(tenantA: string, tenantB: string) {
  return app.inject({
    method: "GET",
    url: `/api/v1/config/diff?tenant_a=${tenantA}&tenant_b=${tenantB}`,
    headers: authHeaders(),
  });
}

describe("config diff scopes both compared tenants to the caller's subtree", () => {
  beforeEach(async () => {
    stratum = createMockStratum();
    (stratum.validateApiKey as ReturnType<typeof vi.fn>).mockResolvedValue({
      key_id: "attacker-key",
      tenant_id: ATTACKER,
      scopes: ["read", "write", "admin"],
      rate_limit_max: null,
      rate_limit_window: null,
    });
    wireCommonMocks();
    app = await buildTestApp(stratum);
  });

  it("refuses diffing against an unrelated tenant", async () => {
    const res = await diff(ATTACKER, VICTIM);
    expect(res.statusCode).toBe(403);
    expect(stratum.diffConfig).not.toHaveBeenCalled();
  });

  it("refuses when the first tenant is unrelated", async () => {
    const res = await diff(VICTIM, ATTACKER);
    expect(res.statusCode).toBe(403);
    expect(stratum.diffConfig).not.toHaveBeenCalled();
  });

  it("allows diffing entirely within the caller's subtree", async () => {
    const res = await diff(ATTACKER, ATTACKER_CHILD);
    expect(res.statusCode).toBe(200);
    expect(stratum.diffConfig).toHaveBeenCalledWith(ATTACKER, ATTACKER_CHILD);
  });
});

describe("role routes scope to the caller's subtree", () => {
  beforeEach(async () => {
    stratum = createMockStratum();
    (stratum.validateApiKey as ReturnType<typeof vi.fn>).mockResolvedValue({
      key_id: "attacker-key",
      tenant_id: ATTACKER,
      scopes: ["read", "write", "admin"],
      rate_limit_max: null,
      rate_limit_window: null,
    });
    wireCommonMocks();
    app = await buildTestApp(stratum);
  });

  it("does not enumerate other tenants' roles when listing without a filter", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/roles", headers: authHeaders() });
    expect(res.statusCode).toBe(200);
    const ids = (res.json() as RoleRow[]).map((r) => r.id);
    expect(ids).not.toContain(ROLE_FOREIGN);
    expect(ids).toContain(ROLE_OWN);
  });

  it("refuses listing a foreign tenant's roles by explicit filter", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/roles?tenant_id=${VICTIM}`,
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(403);
    expect(stratum.listRoles).not.toHaveBeenCalled();
  });

  it("refuses reading a foreign tenant's role", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/roles/${ROLE_FOREIGN}`, headers: authHeaders() });
    expect(res.statusCode).toBe(403);
  });

  it("allows reading a role in the caller's own tenant", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/roles/${ROLE_OWN}`, headers: authHeaders() });
    expect(res.statusCode).toBe(200);
  });

  it("refuses updating a foreign tenant's role", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/roles/${ROLE_FOREIGN}`,
      headers: { ...authHeaders(), "content-type": "application/json" },
      payload: { name: "hijacked" },
    });
    expect(res.statusCode).toBe(403);
    expect(stratum.updateRole).not.toHaveBeenCalled();
  });

  it("refuses deleting a foreign tenant's role", async () => {
    const res = await app.inject({ method: "DELETE", url: `/api/v1/roles/${ROLE_FOREIGN}`, headers: authHeaders() });
    expect(res.statusCode).toBe(403);
    expect(stratum.deleteRole).not.toHaveBeenCalled();
  });

  it("refuses creating a role in a foreign tenant", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/roles",
      headers: { ...authHeaders(), "content-type": "application/json" },
      payload: { name: "planted", scopes: ["read"], tenant_id: VICTIM },
    });
    expect(res.statusCode).toBe(403);
    expect(stratum.createRole).not.toHaveBeenCalled();
  });

  it("refuses assigning a foreign tenant's role to an own key", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/roles/assign/${OWN_KEY}`,
      headers: { ...authHeaders(), "content-type": "application/json" },
      payload: { role_id: ROLE_FOREIGN },
    });
    expect(res.statusCode).toBe(403);
    expect(stratum.assignRoleToKey).not.toHaveBeenCalled();
  });

  it("refuses assigning a role to a key in another tenant", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/roles/assign/${FOREIGN_KEY}`,
      headers: { ...authHeaders(), "content-type": "application/json" },
      payload: { role_id: ROLE_OWN },
    });
    expect(res.statusCode).toBe(403);
    expect(stratum.assignRoleToKey).not.toHaveBeenCalled();
  });

  it("refuses removing a role from a key in another tenant", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/v1/roles/assign/${FOREIGN_KEY}`,
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(403);
    expect(stratum.removeRoleFromKey).not.toHaveBeenCalled();
  });

  it("allows assigning an own role to an own key", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/roles/assign/${OWN_KEY}`,
      headers: { ...authHeaders(), "content-type": "application/json" },
      payload: { role_id: ROLE_OWN },
    });
    expect(res.statusCode).toBe(200);
    expect(stratum.assignRoleToKey).toHaveBeenCalledWith(OWN_KEY, ROLE_OWN);
  });
});

describe("global operator keys keep full access", () => {
  beforeEach(async () => {
    stratum = createMockStratum();
    (stratum.validateApiKey as ReturnType<typeof vi.fn>).mockResolvedValue({
      key_id: "global-key",
      tenant_id: null,
      scopes: ["read", "write", "admin"],
      rate_limit_max: null,
      rate_limit_window: null,
    });
    wireCommonMocks();
    app = await buildTestApp(stratum);
  });

  it("still diffs any two tenants", async () => {
    const res = await diff(ATTACKER, VICTIM);
    expect(res.statusCode).toBe(200);
    expect(stratum.diffConfig).toHaveBeenCalledWith(ATTACKER, VICTIM);
  });

  it("still enumerates every tenant's roles", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/roles", headers: authHeaders() });
    expect(res.statusCode).toBe(200);
    expect((res.json() as RoleRow[]).map((r) => r.id)).toContain(ROLE_FOREIGN);
  });

  it("still reads any tenant's role", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/roles/${ROLE_FOREIGN}`, headers: authHeaders() });
    expect(res.statusCode).toBe(200);
  });

  it("still assigns any role to any key", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/roles/assign/${FOREIGN_KEY}`,
      headers: { ...authHeaders(), "content-type": "application/json" },
      payload: { role_id: ROLE_FOREIGN },
    });
    expect(res.statusCode).toBe(200);
    expect(stratum.assignRoleToKey).toHaveBeenCalledWith(FOREIGN_KEY, ROLE_FOREIGN);
  });
});
