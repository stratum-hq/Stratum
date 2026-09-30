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
      const registered = new MysqlTableAdapter({ pool, databaseName: "testdb", baseTables: ["orders"] });
      const result = registered.scopedTable("acme", "orders");
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

  describe("baseTables", () => {
    it("rejects base tables whose tenant table names could collide", () => {
      expect(
        () => new MysqlTableAdapter({ pool, databaseName: "testdb", baseTables: ["orders", "orders_corp"] }),
      ).toThrow(/ambiguous/);
    });

    it("scopedTable only accepts registered base tables when baseTables is set", () => {
      const registered = new MysqlTableAdapter({ pool, databaseName: "testdb", baseTables: ["orders"] });
      expect(registered.scopedTable("acme", "orders")).toBe("`orders_acme`");
      expect(() => registered.scopedTable("acme", "invoices")).toThrow(/not in baseTables/);
    });
  });

  describe("purgeTenantData", () => {
    it("throws when baseTables is not configured", async () => {
      await expect(adapter.purgeTenantData("acme")).rejects.toThrow(/baseTables/);
      expect(pool.query).not.toHaveBeenCalled();
    });

    it("drops exactly {base}_{slug} for each registered base table", async () => {
      const registered = new MysqlTableAdapter({
        pool,
        databaseName: "testdb",
        baseTables: ["orders", "order_items"],
      });
      (pool.query as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const result = await registered.purgeTenantData("acme");

      expect((pool.query as ReturnType<typeof vi.fn>).mock.calls).toEqual([
        ["DROP TABLE IF EXISTS `testdb`.`orders_acme`"],
        ["DROP TABLE IF EXISTS `testdb`.`order_items_acme`"],
      ]);
      expect(result.success).toBe(true);
      expect(result.tablesProcessed).toBe(2);
      expect(result.rowsDeleted).toBe(0);
    });

    it("reports errors for failed DROP TABLE operations", async () => {
      const registered = new MysqlTableAdapter({
        pool,
        databaseName: "testdb",
        baseTables: ["orders", "fail"],
      });
      (pool.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("drop failed"));

      const result = await registered.purgeTenantData("acme");

      expect(result.success).toBe(false);
      expect(result.errors.length).toBe(1);
      expect(result.tablesProcessed).toBe(1);
    });
  });

  it("returns table-per-tenant strategy stats", () => {
    expect(adapter.getStats()).toEqual({ strategy: "table-per-tenant" });
  });
});
