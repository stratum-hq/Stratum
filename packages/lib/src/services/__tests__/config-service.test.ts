import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock pool-helpers before importing config-service
vi.mock("../../pool-helpers.js", () => ({
  withClient: vi.fn(),
  withTransaction: vi.fn(),
}));

// Mock crypto module
vi.mock("../../crypto.js", () => ({
  encrypt: vi.fn((plaintext: string) => `encrypted:${plaintext}`),
  decrypt: vi.fn((encrypted: string) => {
    if (encrypted.startsWith("encrypted:")) {
      return encrypted.slice("encrypted:".length);
    }
    return encrypted;
  }),
}));

import * as poolHelpers from "../../pool-helpers.js";
import * as configService from "../config-service.js";
import { makeMockPool } from "./test-helpers.js";
import {
  TenantNotFoundError,
  TenantArchivedError,
  ConfigLockedError,
  ConfigNotFoundError,
} from "@stratum-hq/core";

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// resolveConfig
// ---------------------------------------------------------------------------
describe("resolveConfig", () => {
  it("resolves config across a 3-level hierarchy (root -> MSP -> client)", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn();

    // Query 1: SELECT ancestry_path for client tenant (non-archived)
    mockQuery.mockResolvedValueOnce({
      rows: [{ ancestry_path: "/root-id/msp-id" }],
    });

    // Query 2: batch-load config entries for all ancestors + self
    mockQuery.mockResolvedValueOnce({
      rows: [
        // root sets "theme" and "max_users"
        {
          tenant_id: "root-id",
          key: "theme",
          value: JSON.stringify("dark"),
          locked: false,
          sensitive: false,
          source_tenant_id: "root-id",
        },
        {
          tenant_id: "root-id",
          key: "max_users",
          value: JSON.stringify(100),
          locked: false,
          sensitive: false,
          source_tenant_id: "root-id",
        },
        // MSP overrides "theme", adds "region"
        {
          tenant_id: "msp-id",
          key: "theme",
          value: JSON.stringify("light"),
          locked: false,
          sensitive: false,
          source_tenant_id: "msp-id",
        },
        {
          tenant_id: "msp-id",
          key: "region",
          value: JSON.stringify("us-east"),
          locked: false,
          sensitive: false,
          source_tenant_id: "msp-id",
        },
        // Client overrides "max_users"
        {
          tenant_id: "client-id",
          key: "max_users",
          value: JSON.stringify(50),
          locked: false,
          sensitive: false,
          source_tenant_id: "client-id",
        },
      ],
    });

    vi.mocked(poolHelpers.withClient).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    const result = await configService.resolveConfig(pool, "client-id");

    // theme: MSP overrides root -> "light", inherited from client's perspective
    expect(result.theme.value).toBe("light");
    expect(result.theme.inherited).toBe(true);
    expect(result.theme.source_tenant_id).toBe("msp-id");

    // max_users: client overrides root -> 50, not inherited
    expect(result.max_users.value).toBe(50);
    expect(result.max_users.inherited).toBe(false);
    expect(result.max_users.source_tenant_id).toBe("client-id");

    // region: MSP sets it, inherited to client
    expect(result.region.value).toBe("us-east");
    expect(result.region.inherited).toBe(true);
    expect(result.region.source_tenant_id).toBe("msp-id");
  });

  it("inherits config from parent when child has no override", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn();

    mockQuery.mockResolvedValueOnce({
      rows: [{ ancestry_path: "/parent-id" }],
    });

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          tenant_id: "parent-id",
          key: "feature_flag",
          value: JSON.stringify(true),
          locked: false,
          sensitive: false,
          source_tenant_id: "parent-id",
        },
      ],
    });

    vi.mocked(poolHelpers.withClient).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    const result = await configService.resolveConfig(pool, "child-id");

    expect(result.feature_flag.value).toBe(true);
    expect(result.feature_flag.inherited).toBe(true);
    expect(result.feature_flag.source_tenant_id).toBe("parent-id");
  });

  it("child can override parent values", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn();

    mockQuery.mockResolvedValueOnce({
      rows: [{ ancestry_path: "/parent-id" }],
    });

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          tenant_id: "parent-id",
          key: "color",
          value: JSON.stringify("blue"),
          locked: false,
          sensitive: false,
          source_tenant_id: "parent-id",
        },
        {
          tenant_id: "child-id",
          key: "color",
          value: JSON.stringify("red"),
          locked: false,
          sensitive: false,
          source_tenant_id: "child-id",
        },
      ],
    });

    vi.mocked(poolHelpers.withClient).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    const result = await configService.resolveConfig(pool, "child-id");

    expect(result.color.value).toBe("red");
    expect(result.color.inherited).toBe(false);
    expect(result.color.source_tenant_id).toBe("child-id");
  });

  it("locked keys cannot be overridden by children", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn();

    mockQuery.mockResolvedValueOnce({
      rows: [{ ancestry_path: "/parent-id" }],
    });

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          tenant_id: "parent-id",
          key: "security_policy",
          value: JSON.stringify("strict"),
          locked: true,
          sensitive: false,
          source_tenant_id: "parent-id",
        },
        // Child attempts to override locked key
        {
          tenant_id: "child-id",
          key: "security_policy",
          value: JSON.stringify("relaxed"),
          locked: false,
          sensitive: false,
          source_tenant_id: "child-id",
        },
      ],
    });

    vi.mocked(poolHelpers.withClient).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    const result = await configService.resolveConfig(pool, "child-id");

    // Parent's locked value prevails
    expect(result.security_policy.value).toBe("strict");
    expect(result.security_policy.locked).toBe(true);
    expect(result.security_policy.source_tenant_id).toBe("parent-id");
  });

  it("sensitive (encrypted) values are decrypted during resolution", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn();

    mockQuery.mockResolvedValueOnce({
      rows: [{ ancestry_path: "/" }],
    });

    // Sensitive entry: value is stored as JSON-stringified encrypted string
    // The code does: JSON.parse(decrypt(JSON.parse(entry.value as string)))
    // entry.value is stored as: JSON.stringify(encrypt(JSON.stringify(actualValue)))
    // So entry.value = JSON.stringify("encrypted:\"my-secret\"") = '"encrypted:\\"my-secret\\""'
    const encryptedPayload = `encrypted:${JSON.stringify("my-secret")}`;
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          tenant_id: "root-id",
          key: "api_key",
          value: JSON.stringify(encryptedPayload),
          locked: false,
          sensitive: true,
          source_tenant_id: "root-id",
        },
      ],
    });

    vi.mocked(poolHelpers.withClient).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    const result = await configService.resolveConfig(pool, "root-id");

    expect(result.api_key.value).toBe("my-secret");
  });

  it("archived ancestors are excluded from inheritance chain", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn();

    // ancestry path includes an archived ancestor
    mockQuery.mockResolvedValueOnce({
      rows: [{ ancestry_path: "/root-id/archived-id" }],
    });

    // The SQL query joins with tenants WHERE status != 'archived',
    // so archived-id's entries won't be returned
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          tenant_id: "root-id",
          key: "setting",
          value: JSON.stringify("from-root"),
          locked: false,
          sensitive: false,
          source_tenant_id: "root-id",
        },
        // archived-id's entry is NOT returned due to the JOIN filter
        // child has no override
      ],
    });

    vi.mocked(poolHelpers.withClient).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    const result = await configService.resolveConfig(pool, "child-id");

    // Only root's value is present; archived ancestor's config is excluded
    expect(result.setting.value).toBe("from-root");
    expect(result.setting.source_tenant_id).toBe("root-id");
  });

  it("handles empty ancestry path (root tenant)", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn();

    mockQuery.mockResolvedValueOnce({
      rows: [{ ancestry_path: "/" }],
    });

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          tenant_id: "root-id",
          key: "root_setting",
          value: JSON.stringify("value"),
          locked: false,
          sensitive: false,
          source_tenant_id: "root-id",
        },
      ],
    });

    vi.mocked(poolHelpers.withClient).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    const result = await configService.resolveConfig(pool, "root-id");

    expect(result.root_setting.value).toBe("value");
    expect(result.root_setting.inherited).toBe(false);
  });

  it("throws TenantArchivedError when tenant itself is archived", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn();

    // First query: ancestry_path query returns no rows (status='archived' filtered out)
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // Second query: check if tenant exists at all
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "archived-tenant" }] });

    vi.mocked(poolHelpers.withClient).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    await expect(configService.resolveConfig(pool, "archived-tenant")).rejects.toThrow(
      TenantArchivedError,
    );
  });

  it("throws TenantNotFoundError when tenant does not exist", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn();

    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    vi.mocked(poolHelpers.withClient).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    await expect(configService.resolveConfig(pool, "nonexistent")).rejects.toThrow(
      TenantNotFoundError,
    );
  });
});

// ---------------------------------------------------------------------------
// batchSetConfig
// ---------------------------------------------------------------------------
describe("batchSetConfig", () => {
  it("partial success: some keys locked, others succeed", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn();

    // Query 1: SELECT ancestry_path
    mockQuery.mockResolvedValueOnce({
      rows: [{ ancestry_path: "/parent-id" }],
    });

    // Query 2: batch-load ancestor locks
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          key: "locked_key",
          locked: true,
          source_tenant_id: "parent-id",
          tenant_id: "parent-id",
        },
      ],
    });

    // Query 3: INSERT for the unlocked key "open_key"
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "entry-1",
          tenant_id: "child-id",
          key: "open_key",
          value: JSON.stringify("new-value"),
          locked: false,
          sensitive: false,
          source_tenant_id: "child-id",
          inherited: false,
          created_at: "2024-01-01T00:00:00.000Z",
          updated_at: "2024-01-01T00:00:00.000Z",
        },
      ],
    });

    vi.mocked(poolHelpers.withTransaction).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    const result = await configService.batchSetConfig(pool, "child-id", [
      { key: "locked_key", value: "attempt" },
      { key: "open_key", value: "new-value" },
    ]);

    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.results).toHaveLength(2);

    // First result: locked_key failed
    expect(result.results[0].key).toBe("locked_key");
    expect(result.results[0].status).toBe("error");
    expect(result.results[0].error).toContain("locked");

    // Second result: open_key succeeded
    expect(result.results[1].key).toBe("open_key");
    expect(result.results[1].status).toBe("ok");
    expect(result.results[1].entry).toBeDefined();
  });

  it("all keys succeed when none are locked", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn();

    // Query 1: SELECT ancestry_path
    mockQuery.mockResolvedValueOnce({
      rows: [{ ancestry_path: "/parent-id" }],
    });

    // Query 2: no locked keys
    mockQuery.mockResolvedValueOnce({ rows: [] });

    // Query 3 & 4: two INSERT queries succeed
    const makeEntry = (key: string) => ({
      id: `entry-${key}`,
      tenant_id: "child-id",
      key,
      value: JSON.stringify("val"),
      locked: false,
      sensitive: false,
      source_tenant_id: "child-id",
      inherited: false,
      created_at: "2024-01-01T00:00:00.000Z",
      updated_at: "2024-01-01T00:00:00.000Z",
    });

    mockQuery.mockResolvedValueOnce({ rows: [makeEntry("key_a")] });
    mockQuery.mockResolvedValueOnce({ rows: [makeEntry("key_b")] });

    vi.mocked(poolHelpers.withTransaction).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    const result = await configService.batchSetConfig(pool, "child-id", [
      { key: "key_a", value: "val" },
      { key: "key_b", value: "val" },
    ]);

    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.results.every((r) => r.status === "ok")).toBe(true);
  });

  it("all keys locked yields all errors", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn();

    mockQuery.mockResolvedValueOnce({
      rows: [{ ancestry_path: "/parent-id" }],
    });

    mockQuery.mockResolvedValueOnce({
      rows: [
        { key: "k1", locked: true, source_tenant_id: "parent-id", tenant_id: "parent-id" },
        { key: "k2", locked: true, source_tenant_id: "parent-id", tenant_id: "parent-id" },
      ],
    });

    vi.mocked(poolHelpers.withTransaction).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    const result = await configService.batchSetConfig(pool, "child-id", [
      { key: "k1", value: "a" },
      { key: "k2", value: "b" },
    ]);

    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(2);
    expect(result.results.every((r) => r.status === "error")).toBe(true);
  });

  it("throws TenantNotFoundError when tenant does not exist", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn();

    mockQuery.mockResolvedValueOnce({ rows: [] });

    vi.mocked(poolHelpers.withTransaction).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    await expect(
      configService.batchSetConfig(pool, "nonexistent", [{ key: "k", value: "v" }]),
    ).rejects.toThrow(TenantNotFoundError);
  });

  it("root tenant with no ancestors skips lock check", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn();

    // Root has ancestry_path "/"
    mockQuery.mockResolvedValueOnce({
      rows: [{ ancestry_path: "/" }],
    });

    // No lock query issued for root (ancestorIds.length === 0)
    // Direct to INSERT
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "entry-1",
          tenant_id: "root-id",
          key: "setting",
          value: JSON.stringify("val"),
          locked: false,
          sensitive: false,
          source_tenant_id: "root-id",
          inherited: false,
          created_at: "2024-01-01T00:00:00.000Z",
          updated_at: "2024-01-01T00:00:00.000Z",
        },
      ],
    });

    vi.mocked(poolHelpers.withTransaction).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    const result = await configService.batchSetConfig(pool, "root-id", [
      { key: "setting", value: "val" },
    ]);

    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    // Only 2 queries: ancestry_path + INSERT (no lock check)
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// setConfig
// ---------------------------------------------------------------------------
describe("setConfig", () => {
  it("throws ConfigLockedError when ancestor has locked the key", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn();

    mockQuery.mockResolvedValueOnce({
      rows: [{ ancestry_path: "/parent-id" }],
    });

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          key: "locked_key",
          locked: true,
          source_tenant_id: "parent-id",
          tenant_id: "parent-id",
        },
      ],
    });

    vi.mocked(poolHelpers.withTransaction).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    await expect(
      configService.setConfig(pool, "child-id", "locked_key", { value: "override" }),
    ).rejects.toThrow(ConfigLockedError);
  });
});

// ---------------------------------------------------------------------------
// deleteConfig
// ---------------------------------------------------------------------------
describe("deleteConfig", () => {
  it("throws ConfigNotFoundError when key does not exist", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn().mockResolvedValueOnce({ rowCount: 0 });

    vi.mocked(poolHelpers.withTransaction).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    await expect(
      configService.deleteConfig(pool, "tenant-id", "nonexistent_key"),
    ).rejects.toThrow(ConfigNotFoundError);
  });

  it("deletes successfully when key exists", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn().mockResolvedValueOnce({ rowCount: 1 });

    vi.mocked(poolHelpers.withTransaction).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    await expect(
      configService.deleteConfig(pool, "tenant-id", "existing_key"),
    ).resolves.toBeUndefined();
  });
});
