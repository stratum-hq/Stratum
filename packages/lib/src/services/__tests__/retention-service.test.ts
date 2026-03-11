import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../pool-helpers.js", () => ({
  withClient: vi.fn(),
  withTransaction: vi.fn(),
}));

import * as poolHelpers from "../../pool-helpers.js";
import * as retentionService from "../retention-service.js";

function makeMockPool() {
  return {} as import("pg").Pool;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("purgeExpiredData", () => {
  it("deletes expired records and returns total count", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn()
      .mockResolvedValueOnce({ rowCount: 5 })  // webhook_deliveries
      .mockResolvedValueOnce({ rowCount: 3 })  // webhook_events
      .mockResolvedValueOnce({ rowCount: 10 }); // audit_logs

    vi.mocked(poolHelpers.withTransaction).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    const result = await retentionService.purgeExpiredData(pool, 30);

    expect(result).toEqual({ deleted_count: 18 });
    expect(mockQuery).toHaveBeenCalledTimes(3);
    expect(mockQuery.mock.calls[0][0]).toContain("webhook_deliveries");
    expect(mockQuery.mock.calls[1][0]).toContain("webhook_events");
    expect(mockQuery.mock.calls[2][0]).toContain("audit_logs");
  });

  it("uses default 90-day retention when not specified", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn().mockResolvedValue({ rowCount: 0 });

    vi.mocked(poolHelpers.withTransaction).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    await retentionService.purgeExpiredData(pool);

    expect(mockQuery).toHaveBeenCalledTimes(3);
  });
});

describe("purgeTenant", () => {
  it("deletes all tenant data in FK-safe order", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn().mockResolvedValue({ rowCount: 0, rows: [] });

    vi.mocked(poolHelpers.withTransaction).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    await retentionService.purgeTenant(pool, "tenant-123");

    expect(mockQuery).toHaveBeenCalledTimes(8);
    // Verify FK order: config, permissions, api_keys before webhooks/audit before tenant
    expect(mockQuery.mock.calls[0][0]).toContain("config_entries");
    expect(mockQuery.mock.calls[1][0]).toContain("permission_policies");
    expect(mockQuery.mock.calls[2][0]).toContain("api_keys");
    expect(mockQuery.mock.calls[7][0]).toContain("tenants");
    // Verify tenant_id parameter
    expect(mockQuery.mock.calls[0][1]).toEqual(["tenant-123"]);
  });
});

describe("exportTenantData", () => {
  it("returns structured data for the tenant", async () => {
    const pool = makeMockPool();
    const tenantRow = { id: "tenant-123", name: "Test Corp" };
    const mockQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [tenantRow] })   // tenants
      .mockResolvedValueOnce({ rows: [] })             // config_entries
      .mockResolvedValueOnce({ rows: [] })             // permission_policies
      .mockResolvedValueOnce({ rows: [] })             // api_keys
      .mockResolvedValueOnce({ rows: [] })             // webhooks
      .mockResolvedValueOnce({ rows: [] })             // webhook_events
      .mockResolvedValueOnce({ rows: [] })             // webhook_deliveries
      .mockResolvedValueOnce({ rows: [] });            // audit_logs

    vi.mocked(poolHelpers.withClient).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    const result = await retentionService.exportTenantData(pool, "tenant-123");

    expect(result.tenant).toEqual(tenantRow);
    expect(result.config_entries).toEqual([]);
    expect(result.permission_policies).toEqual([]);
    expect(result.api_keys).toEqual([]);
    expect(result.webhooks).toEqual([]);
    expect(result.webhook_events).toEqual([]);
    expect(result.webhook_deliveries).toEqual([]);
    expect(result.audit_logs).toEqual([]);
  });

  it("returns null tenant when not found", async () => {
    const pool = makeMockPool();
    const mockQuery = vi.fn().mockResolvedValue({ rows: [] });

    vi.mocked(poolHelpers.withClient).mockImplementation(async (_pool, fn) => {
      const client = { query: mockQuery } as unknown as import("pg").PoolClient;
      return fn(client);
    });

    const result = await retentionService.exportTenantData(pool, "nonexistent");

    expect(result.tenant).toBeNull();
    expect(mockQuery).toHaveBeenCalledTimes(8);
  });
});
