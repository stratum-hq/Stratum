import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock pool-helpers before importing permission-service
vi.mock("../../pool-helpers.js", () => ({
  withClient: vi.fn(),
  withTransaction: vi.fn(),
}));

import * as poolHelpers from "../../pool-helpers.js";
import * as permissionService from "../permission-service.js";
import { makeMockPool } from "./test-helpers.js";
import {
  PermissionMode,
  RevocationMode,
  PermissionLockedError,
  PermissionNotFoundError,
  PermissionRevocationDeniedError,
  TenantNotFoundError,
} from "@stratum-hq/core";

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// resolvePermissions
// ---------------------------------------------------------------------------
describe("resolvePermissions", () => {
  it("LOCKED mode: child cannot override", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn();

    // Query 1: ancestry_path for child
    mockQuery.mockResolvedValueOnce({
      rows: [{ ancestry_path: "/parent-id" }],
    });

    // Query 2: batch-load all policies
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "policy-1",
          tenant_id: "parent-id",
          key: "can_export",
          value: JSON.stringify(false),
          mode: PermissionMode.LOCKED,
          revocation_mode: RevocationMode.CASCADE,
          source_tenant_id: "parent-id",
          created_at: "2024-01-01T00:00:00.000Z",
          updated_at: "2024-01-01T00:00:00.000Z",
        },
        // Child attempts to set the same key
        {
          id: "policy-2",
          tenant_id: "child-id",
          key: "can_export",
          value: JSON.stringify(true),
          mode: PermissionMode.INHERITED,
          revocation_mode: RevocationMode.CASCADE,
          source_tenant_id: "child-id",
          created_at: "2024-01-01T00:00:00.000Z",
          updated_at: "2024-01-01T00:00:00.000Z",
        },
      ],
    });

    vi.mocked(poolHelpers.withClient).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    const result = await permissionService.resolvePermissions(pool, "child-id");

    // Parent's LOCKED value wins
    expect(result.can_export.value).toBe(JSON.stringify(false));
    expect(result.can_export.locked).toBe(true);
    expect(result.can_export.delegated).toBe(false);
    expect(result.can_export.source_tenant_id).toBe("parent-id");
    expect(result.can_export.mode).toBe(PermissionMode.LOCKED);
  });

  it("INHERITED mode: child can override", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn();

    mockQuery.mockResolvedValueOnce({
      rows: [{ ancestry_path: "/parent-id" }],
    });

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "policy-1",
          tenant_id: "parent-id",
          key: "theme_preference",
          value: JSON.stringify("default"),
          mode: PermissionMode.INHERITED,
          revocation_mode: RevocationMode.CASCADE,
          source_tenant_id: "parent-id",
          created_at: "2024-01-01T00:00:00.000Z",
          updated_at: "2024-01-01T00:00:00.000Z",
        },
        {
          id: "policy-2",
          tenant_id: "child-id",
          key: "theme_preference",
          value: JSON.stringify("custom"),
          mode: PermissionMode.INHERITED,
          revocation_mode: RevocationMode.CASCADE,
          source_tenant_id: "child-id",
          created_at: "2024-01-01T00:00:00.000Z",
          updated_at: "2024-01-01T00:00:00.000Z",
        },
      ],
    });

    vi.mocked(poolHelpers.withClient).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    const result = await permissionService.resolvePermissions(pool, "child-id");

    // Child override prevails
    expect(result.theme_preference.value).toBe(JSON.stringify("custom"));
    expect(result.theme_preference.locked).toBe(false);
    expect(result.theme_preference.delegated).toBe(false);
    expect(result.theme_preference.source_tenant_id).toBe("child-id");
  });

  it("DELEGATED mode: child can override and re-delegate", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn();

    // 3-level hierarchy: root -> msp -> client
    mockQuery.mockResolvedValueOnce({
      rows: [{ ancestry_path: "/root-id/msp-id" }],
    });

    mockQuery.mockResolvedValueOnce({
      rows: [
        // Root sets a DELEGATED permission
        {
          id: "policy-root",
          tenant_id: "root-id",
          key: "billing_access",
          value: JSON.stringify(true),
          mode: PermissionMode.DELEGATED,
          revocation_mode: RevocationMode.CASCADE,
          source_tenant_id: "root-id",
          created_at: "2024-01-01T00:00:00.000Z",
          updated_at: "2024-01-01T00:00:00.000Z",
        },
        // MSP overrides with its own DELEGATED policy
        {
          id: "policy-msp",
          tenant_id: "msp-id",
          key: "billing_access",
          value: JSON.stringify(false),
          mode: PermissionMode.DELEGATED,
          revocation_mode: RevocationMode.CASCADE,
          source_tenant_id: "msp-id",
          created_at: "2024-01-01T00:00:00.000Z",
          updated_at: "2024-01-01T00:00:00.000Z",
        },
        // Client overrides again
        {
          id: "policy-client",
          tenant_id: "client-id",
          key: "billing_access",
          value: JSON.stringify(true),
          mode: PermissionMode.INHERITED,
          revocation_mode: RevocationMode.CASCADE,
          source_tenant_id: "client-id",
          created_at: "2024-01-01T00:00:00.000Z",
          updated_at: "2024-01-01T00:00:00.000Z",
        },
      ],
    });

    vi.mocked(poolHelpers.withClient).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    const result = await permissionService.resolvePermissions(pool, "client-id");

    // Client's final override wins since MSP was DELEGATED (not LOCKED)
    expect(result.billing_access.value).toBe(JSON.stringify(true));
    expect(result.billing_access.source_tenant_id).toBe("client-id");
    expect(result.billing_access.locked).toBe(false);
  });

  it("permission resolution walks ancestor chain correctly", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn();

    // 4-level hierarchy: root -> org -> team -> user
    mockQuery.mockResolvedValueOnce({
      rows: [{ ancestry_path: "/root-id/org-id/team-id" }],
    });

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "p1",
          tenant_id: "root-id",
          key: "feature_a",
          value: JSON.stringify(true),
          mode: PermissionMode.INHERITED,
          revocation_mode: RevocationMode.CASCADE,
          source_tenant_id: "root-id",
          created_at: "2024-01-01T00:00:00.000Z",
          updated_at: "2024-01-01T00:00:00.000Z",
        },
        {
          id: "p2",
          tenant_id: "org-id",
          key: "feature_b",
          value: JSON.stringify("org-value"),
          mode: PermissionMode.INHERITED,
          revocation_mode: RevocationMode.CASCADE,
          source_tenant_id: "org-id",
          created_at: "2024-01-01T00:00:00.000Z",
          updated_at: "2024-01-01T00:00:00.000Z",
        },
        {
          id: "p3",
          tenant_id: "team-id",
          key: "feature_a",
          value: JSON.stringify(false),
          mode: PermissionMode.INHERITED,
          revocation_mode: RevocationMode.CASCADE,
          source_tenant_id: "team-id",
          created_at: "2024-01-01T00:00:00.000Z",
          updated_at: "2024-01-01T00:00:00.000Z",
        },
        // user-id has no policies
      ],
    });

    vi.mocked(poolHelpers.withClient).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    const result = await permissionService.resolvePermissions(pool, "user-id");

    // feature_a: team overrides root
    expect(result.feature_a.value).toBe(JSON.stringify(false));
    expect(result.feature_a.source_tenant_id).toBe("team-id");

    // feature_b: inherited from org
    expect(result.feature_b.value).toBe(JSON.stringify("org-value"));
    expect(result.feature_b.source_tenant_id).toBe("org-id");
  });

  it("throws TenantNotFoundError for unknown tenant", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn().mockResolvedValueOnce({ rows: [] });

    vi.mocked(poolHelpers.withClient).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    await expect(
      permissionService.resolvePermissions(pool, "nonexistent"),
    ).rejects.toThrow(TenantNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// Revocation CASCADE
// ---------------------------------------------------------------------------
describe("deletePermission", () => {
  it("CASCADE: removing parent permission removes children", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn();

    // Query 1: load the policy being deleted
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "policy-parent",
          tenant_id: "parent-id",
          key: "can_access_reports",
          value: JSON.stringify(true),
          mode: PermissionMode.INHERITED,
          revocation_mode: RevocationMode.CASCADE,
          source_tenant_id: "parent-id",
          created_at: "2024-01-01T00:00:00.000Z",
          updated_at: "2024-01-01T00:00:00.000Z",
        },
      ],
    });

    // Query 2: find descendants
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: "child-1" }, { id: "child-2" }],
    });

    // Query 3: DELETE from descendants
    mockQuery.mockResolvedValueOnce({ rowCount: 2 });

    // Query 4: DELETE the parent policy itself
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    vi.mocked(poolHelpers.withTransaction).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    await permissionService.deletePermission(pool, "parent-id", "policy-parent");

    // Verify descendant deletion query was called
    const descendantDeleteCall = mockQuery.mock.calls[2];
    expect(descendantDeleteCall[0]).toContain("DELETE FROM permission_policies");
    expect(descendantDeleteCall[1]).toEqual([["child-1", "child-2"], "can_access_reports"]);

    // Verify parent policy deletion
    const parentDeleteCall = mockQuery.mock.calls[3];
    expect(parentDeleteCall[0]).toContain("DELETE FROM permission_policies WHERE id");
    expect(parentDeleteCall[1]).toEqual(["policy-parent"]);
  });

  it("PERMANENT: cannot revoke a PERMANENT permission", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn();

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "policy-perm",
          tenant_id: "tenant-id",
          key: "immutable_perm",
          value: JSON.stringify(true),
          mode: PermissionMode.INHERITED,
          revocation_mode: RevocationMode.PERMANENT,
          source_tenant_id: "tenant-id",
          created_at: "2024-01-01T00:00:00.000Z",
          updated_at: "2024-01-01T00:00:00.000Z",
        },
      ],
    });

    vi.mocked(poolHelpers.withTransaction).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    await expect(
      permissionService.deletePermission(pool, "tenant-id", "policy-perm"),
    ).rejects.toThrow(PermissionRevocationDeniedError);
  });

  it("SOFT: deletes only the policy, leaving descendants intact", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn();

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "policy-soft",
          tenant_id: "tenant-id",
          key: "soft_perm",
          value: JSON.stringify(true),
          mode: PermissionMode.INHERITED,
          revocation_mode: RevocationMode.SOFT,
          source_tenant_id: "tenant-id",
          created_at: "2024-01-01T00:00:00.000Z",
          updated_at: "2024-01-01T00:00:00.000Z",
        },
      ],
    });

    // Only one DELETE for the policy itself
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    vi.mocked(poolHelpers.withTransaction).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    await permissionService.deletePermission(pool, "tenant-id", "policy-soft");

    // Only 2 queries: select existing + delete self
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls[1][0]).toContain("DELETE FROM permission_policies WHERE id");
  });

  it("throws PermissionNotFoundError when policy does not exist", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn().mockResolvedValueOnce({ rows: [] });

    vi.mocked(poolHelpers.withTransaction).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    await expect(
      permissionService.deletePermission(pool, "tenant-id", "nonexistent"),
    ).rejects.toThrow(PermissionNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// createPermission
// ---------------------------------------------------------------------------
describe("createPermission", () => {
  it("rejects when ancestor has LOCKED the key", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn();

    // Query 1: ancestry_path
    mockQuery.mockResolvedValueOnce({
      rows: [{ ancestry_path: "/ancestor-id" }],
    });

    // Query 2: ancestor lock check
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "locked-policy",
          tenant_id: "ancestor-id",
          key: "locked_perm",
          mode: PermissionMode.LOCKED,
          source_tenant_id: "ancestor-id",
        },
      ],
    });

    vi.mocked(poolHelpers.withTransaction).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    await expect(
      permissionService.createPermission(pool, "child-id", {
        key: "locked_perm",
        value: true,
        mode: PermissionMode.INHERITED,
        revocation_mode: RevocationMode.CASCADE,
      }),
    ).rejects.toThrow(PermissionLockedError);
  });

  it("creates permission successfully when no ancestor lock exists", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn();

    // ancestry_path
    mockQuery.mockResolvedValueOnce({
      rows: [{ ancestry_path: "/parent-id" }],
    });

    // no locked ancestors
    mockQuery.mockResolvedValueOnce({ rows: [] });

    // INSERT returning new policy
    const newPolicy = {
      id: "new-policy-id",
      tenant_id: "child-id",
      key: "new_perm",
      value: JSON.stringify(true),
      mode: PermissionMode.INHERITED,
      revocation_mode: RevocationMode.CASCADE,
      source_tenant_id: "child-id",
      created_at: "2024-01-01T00:00:00.000Z",
      updated_at: "2024-01-01T00:00:00.000Z",
    };
    mockQuery.mockResolvedValueOnce({ rows: [newPolicy] });

    vi.mocked(poolHelpers.withTransaction).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    const result = await permissionService.createPermission(pool, "child-id", {
      key: "new_perm",
      value: true,
      mode: PermissionMode.INHERITED,
      revocation_mode: RevocationMode.CASCADE,
    });

    expect(result.id).toBe("new-policy-id");
    expect(result.key).toBe("new_perm");
  });

  it("root tenant skips ancestor lock check", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn();

    // Root has ancestry_path "/"
    mockQuery.mockResolvedValueOnce({
      rows: [{ ancestry_path: "/" }],
    });

    // No lock check query issued (ancestorIds.length === 0)
    // Direct to INSERT
    const newPolicy = {
      id: "root-policy",
      tenant_id: "root-id",
      key: "admin_access",
      value: JSON.stringify(true),
      mode: PermissionMode.LOCKED,
      revocation_mode: RevocationMode.CASCADE,
      source_tenant_id: "root-id",
      created_at: "2024-01-01T00:00:00.000Z",
      updated_at: "2024-01-01T00:00:00.000Z",
    };
    mockQuery.mockResolvedValueOnce({ rows: [newPolicy] });

    vi.mocked(poolHelpers.withTransaction).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    const result = await permissionService.createPermission(pool, "root-id", {
      key: "admin_access",
      value: true,
      mode: PermissionMode.LOCKED,
      revocation_mode: RevocationMode.CASCADE,
    });

    expect(result.id).toBe("root-policy");
    // Only 2 queries: ancestry + INSERT (no lock check)
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});
