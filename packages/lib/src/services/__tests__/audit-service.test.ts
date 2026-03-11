import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock pool-helpers before importing audit-service
vi.mock("../../pool-helpers.js", () => ({
  withClient: vi.fn(),
  withTransaction: vi.fn(),
}));

import * as poolHelpers from "../../pool-helpers.js";
import * as auditService from "../audit-service.js";
import type { AuditContext, AuditEntry } from "@stratum/core";

function makeMockPool() {
  return {} as import("pg").Pool;
}

const mockAuditContext: AuditContext = {
  actor_id: "key-123",
  actor_type: "api_key",
  source_ip: "192.168.1.1",
  request_id: "req-abc",
};

const mockEntry: AuditEntry = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  actor_id: "key-123",
  actor_type: "api_key",
  action: "tenant.created",
  resource_type: "tenant",
  resource_id: "tenant-456",
  tenant_id: "tenant-456",
  source_ip: "192.168.1.1",
  request_id: "req-abc",
  before_state: null,
  after_state: { name: "Acme" },
  metadata: {},
  created_at: "2024-01-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createAuditEntry", () => {
  it("inserts an audit entry and returns it", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn().mockResolvedValue({ rows: [mockEntry] });
    vi.mocked(poolHelpers.withClient).mockImplementation(async (_pool, fn) => {
      const client = {
        query: mockQuery,
      } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    const result = await auditService.createAuditEntry(
      pool,
      mockAuditContext,
      "tenant.created",
      "tenant",
      "tenant-456",
      "tenant-456",
      null,
      { name: "Acme" },
    );

    expect(result).toEqual(mockEntry);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("INSERT INTO audit_logs");
    expect(params[0]).toBe("key-123"); // actor_id
    expect(params[1]).toBe("api_key"); // actor_type
    expect(params[2]).toBe("tenant.created"); // action
    expect(params[3]).toBe("tenant"); // resource_type
    expect(params[4]).toBe("tenant-456"); // resource_id
    expect(params[5]).toBe("tenant-456"); // tenant_id
  });

  it("handles optional fields as null", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn().mockResolvedValue({ rows: [mockEntry] });
    vi.mocked(poolHelpers.withClient).mockImplementation(async (_pool, fn) => {
      const client = {
        query: mockQuery,
      } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    const context: AuditContext = {
      actor_id: "sys",
      actor_type: "system",
    };

    await auditService.createAuditEntry(
      pool, context, "tenant.deleted", "tenant", "t-1", null,
    );

    const params = mockQuery.mock.calls[0][1];
    expect(params[5]).toBeNull(); // tenant_id
    expect(params[6]).toBeNull(); // source_ip
    expect(params[7]).toBeNull(); // request_id
    expect(params[8]).toBeNull(); // before_state
    expect(params[9]).toBeNull(); // after_state
  });
});

describe("queryAuditLogs", () => {
  it("returns all entries when no filters", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn().mockResolvedValue({ rows: [mockEntry] });
    vi.mocked(poolHelpers.withClient).mockImplementation(async (_pool, fn) => {
      const client = {
        query: mockQuery,
      } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    const result = await auditService.queryAuditLogs(pool, { limit: 50 });

    expect(result).toEqual([mockEntry]);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).not.toContain("WHERE");
    expect(params).toEqual([50]); // just the limit
  });

  it("applies tenant_id filter", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn().mockResolvedValue({ rows: [mockEntry] });
    vi.mocked(poolHelpers.withClient).mockImplementation(async (_pool, fn) => {
      const client = {
        query: mockQuery,
      } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    await auditService.queryAuditLogs(pool, {
      tenant_id: "tenant-456",
      limit: 10,
    });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("tenant_id = $1");
    expect(params[0]).toBe("tenant-456");
    expect(params[1]).toBe(10); // limit
  });

  it("applies action and resource_type filters", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
    vi.mocked(poolHelpers.withClient).mockImplementation(async (_pool, fn) => {
      const client = {
        query: mockQuery,
      } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    await auditService.queryAuditLogs(pool, {
      action: "tenant.created",
      resource_type: "tenant",
      limit: 25,
    });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("action = $1");
    expect(sql).toContain("resource_type = $2");
    expect(params).toEqual(["tenant.created", "tenant", 25]);
  });

  it("applies cursor for pagination", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
    vi.mocked(poolHelpers.withClient).mockImplementation(async (_pool, fn) => {
      const client = {
        query: mockQuery,
      } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    await auditService.queryAuditLogs(pool, {
      cursor: "550e8400-e29b-41d4-a716-446655440000",
      limit: 50,
    });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("id < $1");
    expect(params[0]).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("applies date range filters", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn().mockResolvedValue({ rows: [] });
    vi.mocked(poolHelpers.withClient).mockImplementation(async (_pool, fn) => {
      const client = {
        query: mockQuery,
      } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    await auditService.queryAuditLogs(pool, {
      from: "2024-01-01T00:00:00.000Z",
      to: "2024-12-31T23:59:59.000Z",
      limit: 50,
    });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("created_at >= $1");
    expect(sql).toContain("created_at <= $2");
    expect(params[0]).toBe("2024-01-01T00:00:00.000Z");
    expect(params[1]).toBe("2024-12-31T23:59:59.000Z");
  });
});

describe("getAuditEntry", () => {
  it("returns entry when found", async () => {
    const pool = makeMockPool();
    vi.mocked(poolHelpers.withClient).mockImplementation(async (_pool, fn) => {
      const client = {
        query: vi.fn().mockResolvedValue({ rows: [mockEntry] }),
      } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    const result = await auditService.getAuditEntry(pool, mockEntry.id);
    expect(result).toEqual(mockEntry);
  });

  it("returns null when not found", async () => {
    const pool = makeMockPool();
    vi.mocked(poolHelpers.withClient).mockImplementation(async (_pool, fn) => {
      const client = {
        query: vi.fn().mockResolvedValue({ rows: [] }),
      } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    const result = await auditService.getAuditEntry(pool, "nonexistent-id");
    expect(result).toBeNull();
  });
});
