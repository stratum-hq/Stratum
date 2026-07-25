import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock pool-helpers before importing role-service
vi.mock("../../pool-helpers.js", () => ({
  withClient: vi.fn(),
  withTransaction: vi.fn(),
}));

import * as poolHelpers from "../../pool-helpers.js";
import * as roleService from "../role-service.js";
import { makeMockPool } from "./test-helpers.js";

/** Wire withClient to call the callback with a { query } client. */
function withMockQuery(mockQuery: ReturnType<typeof vi.fn>) {
  vi.mocked(poolHelpers.withClient).mockImplementation(async (_pool, fn) => {
    const client = { query: mockQuery } as unknown as import("pg").PoolClient;
    return fn(client);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("assignRole", () => {
  it("upserts a principal role assignment and returns true", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn().mockResolvedValueOnce({ rows: [{ role_id: "role-1" }] });
    withMockQuery(mockQuery);

    const ok = await roleService.assignRole(pool, "user", "user-1", "role-1");

    expect(ok).toBe(true);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("INSERT INTO principal_roles");
    expect(sql).toContain("ON CONFLICT");
    expect(params).toEqual(["user", "user-1", "role-1", null]);
  });

  it("scopes the role to a tenant when tenantId is passed", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn().mockResolvedValueOnce({ rows: [{ role_id: "role-1" }] });
    withMockQuery(mockQuery);

    await roleService.assignRole(pool, "user", "user-1", "role-1", "tenant-1");

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("WHERE EXISTS");
    expect(sql).toContain("tenant_id = $4 OR tenant_id IS NULL");
    expect(params).toEqual(["user", "user-1", "role-1", "tenant-1"]);
  });

  it("returns false when the role belongs to another tenant (refused)", async () => {
    const pool = makeMockPool();
    // The guarded INSERT ... SELECT ... WHERE EXISTS writes no row.
    const mockQuery = vi.fn().mockResolvedValueOnce({ rows: [] });
    withMockQuery(mockQuery);

    const ok = await roleService.assignRole(pool, "user", "user-1", "foreign-role", "tenant-1");
    expect(ok).toBe(false);
  });
});

describe("removeRole", () => {
  it("returns true when an assignment is removed", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn().mockResolvedValueOnce({ rows: [{ role_id: "role-1" }] });
    withMockQuery(mockQuery);

    const ok = await roleService.removeRole(pool, "user", "user-1");

    expect(ok).toBe(true);
    expect(mockQuery.mock.calls[0][0]).toContain("DELETE FROM principal_roles");
    expect(mockQuery.mock.calls[0][1]).toEqual(["user", "user-1"]);
  });

  it("returns false when there was no assignment", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn().mockResolvedValueOnce({ rows: [] });
    withMockQuery(mockQuery);

    const ok = await roleService.removeRole(pool, "user", "ghost");
    expect(ok).toBe(false);
  });
});

describe("resolveEffectiveScopes", () => {
  it("returns the role's scopes when a role is assigned (role wins over column)", async () => {
    const pool = makeMockPool();
    const mockQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ scopes: ["read", "write"], role_scopes: ["admin"] }] });
    withMockQuery(mockQuery);

    const scopes = await roleService.resolveEffectiveScopes(pool, "key-1");

    expect(scopes).toEqual(["admin"]);
    const [sql, params] = mockQuery.mock.calls[0];
    // Single source LEFT JOINs roles so an assigned role governs.
    expect(sql).toContain("LEFT JOIN roles r ON r.id = ak.role_id");
    expect(sql).toContain("ak.revoked_at IS NULL");
    expect(params).toEqual(["key-1"]);
  });

  it("falls back to the key's column scopes when no role is assigned", async () => {
    const pool = makeMockPool();
    const mockQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ scopes: ["read", "write"], role_scopes: null }] });
    withMockQuery(mockQuery);

    expect(await roleService.resolveEffectiveScopes(pool, "key-1")).toEqual(["read", "write"]);
  });

  it("defaults to [read] when the key has neither a role nor column scopes", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn().mockResolvedValueOnce({ rows: [{ scopes: null, role_scopes: null }] });
    withMockQuery(mockQuery);

    expect(await roleService.resolveEffectiveScopes(pool, "key-1")).toEqual(["read"]);
  });

  it("fails closed with [read] when the key does not exist", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn().mockResolvedValueOnce({ rows: [] });
    withMockQuery(mockQuery);

    expect(await roleService.resolveEffectiveScopes(pool, "ghost")).toEqual(["read"]);
  });
});

describe("resolveKeyScopes", () => {
  it("delegates to resolveEffectiveScopes (same single source)", async () => {
    const pool = makeMockPool();
    const mockQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ scopes: ["read"], role_scopes: ["admin"] }] });
    withMockQuery(mockQuery);

    const scopes = await roleService.resolveKeyScopes(pool, "key-1");

    expect(scopes).toEqual(["admin"]);
    expect(mockQuery.mock.calls[0][0]).toContain("LEFT JOIN roles r ON r.id = ak.role_id");
  });
});

describe("resolvePrincipalScopes", () => {
  it("returns the assigned role's scopes", async () => {
    const pool = makeMockPool();
    const mockQuery = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ scopes: ["read", "write"] }] });
    withMockQuery(mockQuery);

    const scopes = await roleService.resolvePrincipalScopes(pool, "user", "user-1");

    expect(scopes).toEqual(["read", "write"]);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("JOIN roles r ON r.id = pr.role_id");
    expect(params).toEqual(["user", "user-1", null]);
  });

  it("scopes resolution to a tenant when tenantId is passed", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn().mockResolvedValueOnce({ rows: [{ scopes: ["read"] }] });
    withMockQuery(mockQuery);

    await roleService.resolvePrincipalScopes(pool, "user", "user-1", "tenant-1");

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("r.tenant_id = $3 OR r.tenant_id IS NULL");
    expect(params).toEqual(["user", "user-1", "tenant-1"]);
  });

  it("fails closed with [] when the principal has no role", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn().mockResolvedValueOnce({ rows: [] });
    withMockQuery(mockQuery);

    const scopes = await roleService.resolvePrincipalScopes(pool, "user", "ghost");
    expect(scopes).toEqual([]);
  });
});
