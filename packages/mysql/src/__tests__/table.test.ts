import { describe, it, expect, vi, beforeEach } from "vitest";
import { MysqlTableAdapter } from "../adapters/table.js";
import type { MysqlPoolLike } from "../types.js";

function createMockPool(): MysqlPoolLike {
  return {
    getConnection: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue([]),
      release: vi.fn(),
      end: vi.fn().mockResolvedValue(undefined),
    }),
    query: vi.fn().mockResolvedValue([[], []]),
    end: vi.fn().mockResolvedValue(undefined),
  };
}

describe("MysqlTableAdapter", () => {
  let pool: MysqlPoolLike;
  let adapter: MysqlTableAdapter;

  beforeEach(() => {
    pool = createMockPool();
    adapter = new MysqlTableAdapter({ pool, databaseName: "testdb" });
  });

  describe("scopedTable", () => {
    it("returns the escaped tenant-scoped table name", () => {
      const result = adapter.scopedTable("acme", "orders");
      expect(result).toBe("`orders_acme`");
    });

    it("rejects invalid slugs", () => {
      expect(() => adapter.scopedTable("INVALID", "orders")).toThrow("Invalid tenant slug");
      expect(() => adapter.scopedTable("has-hyphens", "orders")).toThrow("Invalid tenant slug");
      expect(() => adapter.scopedTable("", "orders")).toThrow("Invalid tenant slug");
    });
  });

  describe("getPool", () => {
    it("returns the underlying pool", () => {
      expect(adapter.getPool()).toBe(pool);
    });
  });

  describe("purgeTenantData", () => {
    it("discovers and drops tenant tables matching the slug pattern", async () => {
      (pool.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([[{ "Tables_in_testdb (orders_acme)": "orders_acme" }], []])
        .mockResolvedValue(undefined);

      const result = await adapter.purgeTenantData("acme");

      expect(pool.query).toHaveBeenCalledWith(
        "SHOW TABLES FROM `testdb` LIKE ?",
        ["%_acme"],
      );
      expect(result.success).toBe(true);
      expect(result.tablesProcessed).toBe(1);
      expect(result.rowsDeleted).toBe(0);
    });

    it("returns success with zero tablesProcessed when no matching tables", async () => {
      (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([[], []]);

      const result = await adapter.purgeTenantData("acme");

      expect(result.success).toBe(true);
      expect(result.tablesProcessed).toBe(0);
      expect(result.errors.length).toBe(0);
    });

    it("reports errors for failed DROP TABLE operations", async () => {
      (pool.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([[{ Tables: "orders_acme" }, { Tables: "fail_acme" }], []])
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("drop failed"));

      const result = await adapter.purgeTenantData("acme");

      expect(result.success).toBe(false);
      expect(result.errors.length).toBe(1);
      expect(result.tablesProcessed).toBe(1);
    });
  });

  it("returns table-per-tenant strategy stats", () => {
    expect(adapter.getStats()).toEqual({ strategy: "table-per-tenant" });
  });
});
