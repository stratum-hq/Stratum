import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock pool-helpers before importing tenant-service
vi.mock("../../pool-helpers.js", () => ({
  withClient: vi.fn(),
  withTransaction: vi.fn(),
}));

import * as poolHelpers from "../../pool-helpers.js";
import * as tenantService from "../tenant-service.js";
import { makeMockPool } from "./test-helpers.js";
import type { CreateTenantInput } from "@stratum-hq/core";
import {
  TenantNotFoundError,
  TenantArchivedError,
  TenantCycleDetectedError,
  TenantHasChildrenError,
} from "@stratum-hq/core";

function makeInput(overrides: Partial<CreateTenantInput> = {}): CreateTenantInput {
  return {
    parent_id: null,
    name: "Test",
    slug: "test",
    config: {},
    metadata: {},
    isolation_strategy: "SHARED_RLS",
    ...overrides,
  } as CreateTenantInput;
}

const NOW = "2024-01-01T00:00:00.000Z";

function makeTenant(overrides: Record<string, unknown> = {}) {
  return {
    id: "tenant-1",
    parent_id: null as string | null,
    ancestry_path: "/",
    depth: 0,
    name: "Root",
    slug: "root",
    config: {},
    metadata: {},
    isolation_strategy: "SHARED_RLS",
    status: "active" as string,
    region_id: null,
    deleted_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// createTenant
// ---------------------------------------------------------------------------
describe("createTenant", () => {
  it("creates a tenant with a parent (advisory lock acquired)", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn();

    const parent = makeTenant({
      id: "parent-1",
      name: "Parent",
      slug: "parent",
      ancestry_path: "/",
      depth: 0,
    });

    const child = makeTenant({
      id: "child-1",
      parent_id: "parent-1",
      name: "Child",
      slug: "child",
      ancestry_path: "/parent-1",
      depth: 1,
    });

    // Query 1: pg_advisory_xact_lock
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // Query 2: SELECT parent
    mockQuery.mockResolvedValueOnce({ rows: [parent] });
    // Query 3: INSERT child
    mockQuery.mockResolvedValueOnce({ rows: [child] });

    vi.mocked(poolHelpers.withTransaction).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    const result = await tenantService.createTenant(pool, makeInput({
      parent_id: "parent-1",
      name: "Child",
      slug: "child",
    }));

    expect(result.id).toBe("child-1");
    expect(result.parent_id).toBe("parent-1");
    expect(result.ancestry_path).toBe("/parent-1");

    // Verify advisory lock was acquired
    expect(mockQuery.mock.calls[0][0]).toContain("pg_advisory_xact_lock");
    expect(mockQuery.mock.calls[0][1]).toEqual(["parent-1"]);
  });

  it("creates a root tenant without parent", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn();

    const rootTenant = makeTenant({
      id: "root-1",
      parent_id: null,
      name: "Root Org",
      slug: "root_org",
      ancestry_path: "/",
      depth: 0,
    });

    // Only one query: INSERT (no advisory lock, no parent lookup)
    mockQuery.mockResolvedValueOnce({ rows: [rootTenant] });

    vi.mocked(poolHelpers.withTransaction).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    const result = await tenantService.createTenant(pool, makeInput({
      parent_id: null,
      name: "Root Org",
      slug: "root_org",
    }));

    expect(result.id).toBe("root-1");
    expect(result.parent_id).toBeNull();
    expect(result.ancestry_path).toBe("/");
    expect(result.depth).toBe(0);

    // Only 1 query: the INSERT
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0]).toContain("INSERT INTO tenants");
  });

  it("throws TenantArchivedError when parent is archived", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn();

    const archivedParent = makeTenant({
      id: "archived-parent",
      status: "archived",
    });

    // Query 1: advisory lock
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // Query 2: SELECT parent - returns archived parent
    mockQuery.mockResolvedValueOnce({ rows: [archivedParent] });

    vi.mocked(poolHelpers.withTransaction).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    await expect(
      tenantService.createTenant(pool, makeInput({
        parent_id: "archived-parent",
        name: "Child",
        slug: "child",
      })),
    ).rejects.toThrow(TenantArchivedError);
  });

  it("throws TenantNotFoundError when parent does not exist", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn();

    // advisory lock
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // parent not found
    mockQuery.mockResolvedValueOnce({ rows: [] });

    vi.mocked(poolHelpers.withTransaction).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    await expect(
      tenantService.createTenant(pool, makeInput({
        parent_id: "nonexistent",
        name: "Child",
        slug: "child",
      })),
    ).rejects.toThrow(TenantNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// moveTenant
// ---------------------------------------------------------------------------
describe("moveTenant", () => {
  it("throws TenantCycleDetectedError when moving to own descendant", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn();

    const tenant = makeTenant({
      id: "parent-id",
      ancestry_path: "/root-id",
      depth: 1,
      status: "active",
    });

    const newParent = makeTenant({
      id: "child-id",
      parent_id: "parent-id",
      ancestry_path: "/root-id/parent-id",
      depth: 2,
      status: "active",
    });

    // Query 1: advisory lock on tenant
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // Query 2: advisory lock on new parent
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // Query 3: SELECT tenant being moved
    mockQuery.mockResolvedValueOnce({ rows: [tenant] });
    // Query 4: SELECT new parent
    mockQuery.mockResolvedValueOnce({ rows: [newParent] });

    vi.mocked(poolHelpers.withTransaction).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    await expect(
      tenantService.moveTenant(pool, "parent-id", "child-id"),
    ).rejects.toThrow(TenantCycleDetectedError);
  });

  it("throws TenantCycleDetectedError when moving tenant to itself", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn();

    const tenant = makeTenant({
      id: "same-id",
      ancestry_path: "/root-id",
      depth: 1,
      status: "active",
    });

    // Both queries return the same tenant
    mockQuery.mockResolvedValueOnce({ rows: [] }); // advisory lock 1
    mockQuery.mockResolvedValueOnce({ rows: [] }); // advisory lock 2
    mockQuery.mockResolvedValueOnce({ rows: [tenant] }); // SELECT tenant
    mockQuery.mockResolvedValueOnce({ rows: [tenant] }); // SELECT new parent (same)

    vi.mocked(poolHelpers.withTransaction).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    await expect(
      tenantService.moveTenant(pool, "same-id", "same-id"),
    ).rejects.toThrow(TenantCycleDetectedError);
  });

  it("throws TenantNotFoundError when tenant being moved does not exist", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn();

    mockQuery.mockResolvedValueOnce({ rows: [] }); // advisory lock 1
    mockQuery.mockResolvedValueOnce({ rows: [] }); // advisory lock 2
    mockQuery.mockResolvedValueOnce({ rows: [] }); // tenant not found

    vi.mocked(poolHelpers.withTransaction).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    await expect(
      tenantService.moveTenant(pool, "nonexistent", "some-parent"),
    ).rejects.toThrow(TenantNotFoundError);
  });

  it("successfully moves a tenant to a valid new parent", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn();

    const tenant = makeTenant({
      id: "move-me",
      parent_id: "old-parent",
      ancestry_path: "/old-parent",
      depth: 1,
      status: "active",
    });

    const newParent = makeTenant({
      id: "new-parent",
      ancestry_path: "/",
      depth: 0,
      status: "active",
    });

    const updatedTenant = makeTenant({
      id: "move-me",
      parent_id: "new-parent",
      ancestry_path: "/new-parent",
      depth: 1,
      status: "active",
    });

    mockQuery.mockResolvedValueOnce({ rows: [] }); // advisory lock 1
    mockQuery.mockResolvedValueOnce({ rows: [] }); // advisory lock 2
    mockQuery.mockResolvedValueOnce({ rows: [tenant] }); // SELECT tenant
    mockQuery.mockResolvedValueOnce({ rows: [newParent] }); // SELECT new parent
    mockQuery.mockResolvedValueOnce({ rows: [updatedTenant] }); // UPDATE tenant
    mockQuery.mockResolvedValueOnce({ rows: [] }); // SELECT descendants (none)

    vi.mocked(poolHelpers.withTransaction).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    const result = await tenantService.moveTenant(pool, "move-me", "new-parent");

    expect(result.id).toBe("move-me");
    expect(result.parent_id).toBe("new-parent");
    expect(result.ancestry_path).toBe("/new-parent");
  });
});

// ---------------------------------------------------------------------------
// deleteTenant (soft delete)
// ---------------------------------------------------------------------------
describe("deleteTenant", () => {
  it("soft deletes a tenant with no active children", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn();

    const tenant = makeTenant({
      id: "delete-me",
      status: "active",
    });

    // Query 1: SELECT existing tenant
    mockQuery.mockResolvedValueOnce({ rows: [tenant] });
    // Query 2: COUNT children
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "0" }] });
    // Query 3: UPDATE to archived
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    vi.mocked(poolHelpers.withTransaction).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    await expect(tenantService.deleteTenant(pool, "delete-me")).resolves.toBeUndefined();

    // Verify the UPDATE sets status to 'archived'
    const updateCall = mockQuery.mock.calls[2];
    expect(updateCall[0]).toContain("status = 'archived'");
    expect(updateCall[0]).toContain("deleted_at = now()");
  });

  it("throws TenantHasChildrenError when tenant has active children", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn();

    const tenant = makeTenant({ id: "parent-with-kids", status: "active" });

    mockQuery.mockResolvedValueOnce({ rows: [tenant] });
    mockQuery.mockResolvedValueOnce({ rows: [{ count: "3" }] });

    vi.mocked(poolHelpers.withTransaction).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    await expect(
      tenantService.deleteTenant(pool, "parent-with-kids"),
    ).rejects.toThrow(TenantHasChildrenError);
  });

  it("throws TenantNotFoundError when tenant does not exist or is already archived", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn();

    mockQuery.mockResolvedValueOnce({ rows: [] });

    vi.mocked(poolHelpers.withTransaction).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    await expect(tenantService.deleteTenant(pool, "nonexistent")).rejects.toThrow(
      TenantNotFoundError,
    );
  });
});

// ---------------------------------------------------------------------------
// getAncestors
// ---------------------------------------------------------------------------
describe("getAncestors", () => {
  it("returns correct ancestor chain", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn();

    const leaf = makeTenant({
      id: "leaf-id",
      ancestry_path: "/root-id/mid-id/leaf-id",
      depth: 3,
    });

    const root = makeTenant({ id: "root-id", depth: 0, ancestry_path: "/" });
    const mid = makeTenant({
      id: "mid-id",
      depth: 1,
      ancestry_path: "/root-id",
      parent_id: "root-id",
    });

    // Query 1: SELECT leaf tenant
    mockQuery.mockResolvedValueOnce({ rows: [leaf] });
    // Query 2: SELECT ancestors ORDER BY depth ASC
    mockQuery.mockResolvedValueOnce({ rows: [root, mid] });

    vi.mocked(poolHelpers.withClient).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    const result = await tenantService.getAncestors(pool, "leaf-id");

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("root-id");
    expect(result[1].id).toBe("mid-id");
  });

  it("returns empty array for root tenant", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn();

    const root = makeTenant({ id: "root-id", ancestry_path: "/", depth: 0 });

    // Query 1: SELECT root tenant (ancestry_path="/")
    mockQuery.mockResolvedValueOnce({ rows: [root] });
    // getAncestorIds("/") returns [] from parseAncestryPath, then slicing gives []
    // so getAncestors returns early with []

    vi.mocked(poolHelpers.withClient).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    const result = await tenantService.getAncestors(pool, "root-id");

    expect(result).toEqual([]);
    // Only 1 query: SELECT the tenant (no ancestor query needed)
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("throws TenantNotFoundError for unknown tenant", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn().mockResolvedValueOnce({ rows: [] });

    vi.mocked(poolHelpers.withClient).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    await expect(tenantService.getAncestors(pool, "nonexistent")).rejects.toThrow(
      TenantNotFoundError,
    );
  });
});

// ---------------------------------------------------------------------------
// getDescendants
// ---------------------------------------------------------------------------
describe("getDescendants", () => {
  it("returns subtree", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn();

    // Query 1: check existence
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "parent-id" }] });
    // Query 2: SELECT descendants
    const child1 = makeTenant({
      id: "child-1",
      parent_id: "parent-id",
      ancestry_path: "/parent-id",
      depth: 1,
    });
    const grandchild1 = makeTenant({
      id: "grandchild-1",
      parent_id: "child-1",
      ancestry_path: "/parent-id/child-1",
      depth: 2,
    });
    mockQuery.mockResolvedValueOnce({ rows: [child1, grandchild1] });

    vi.mocked(poolHelpers.withClient).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    const result = await tenantService.getDescendants(pool, "parent-id");

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("child-1");
    expect(result[1].id).toBe("grandchild-1");
  });

  it("returns empty array when no descendants exist", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn();

    mockQuery.mockResolvedValueOnce({ rows: [{ id: "leaf-id" }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    vi.mocked(poolHelpers.withClient).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    const result = await tenantService.getDescendants(pool, "leaf-id");

    expect(result).toEqual([]);
  });

  it("throws TenantNotFoundError for unknown tenant", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn().mockResolvedValueOnce({ rows: [] });

    vi.mocked(poolHelpers.withClient).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    await expect(tenantService.getDescendants(pool, "nonexistent")).rejects.toThrow(
      TenantNotFoundError,
    );
  });
});
