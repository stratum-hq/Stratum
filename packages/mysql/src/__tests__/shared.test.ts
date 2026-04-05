import { describe, it, expect, vi, beforeEach } from "vitest";
import { MysqlSharedAdapter } from "../adapters/shared.js";
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

describe("MysqlSharedAdapter", () => {
  let pool: MysqlPoolLike;
  let adapter: MysqlSharedAdapter;

  beforeEach(() => {
    pool = createMockPool();
    adapter = new MysqlSharedAdapter({ pool, databaseName: "testdb" });
  });

  describe("scopedSelect", () => {
    it("injects tenant_id into WHERE clause", async () => {
      await adapter.scopedSelect("tenant1", "users");
      expect(pool.query).toHaveBeenCalledWith(
        "SELECT * FROM `testdb`.`users` WHERE tenant_id = ?",
        ["tenant1"],
      );
    });

    it("includes additional conditions as AND clauses", async () => {
      await adapter.scopedSelect("tenant1", "users", { status: "active" });
      expect(pool.query).toHaveBeenCalledWith(
        "SELECT * FROM `testdb`.`users` WHERE tenant_id = ? AND `status` = ?",
        ["tenant1", "active"],
      );
    });

    it("uses specified columns instead of *", async () => {
      await adapter.scopedSelect("tenant1", "users", undefined, ["id", "name"]);
      expect(pool.query).toHaveBeenCalledWith(
        "SELECT `id`, `name` FROM `testdb`.`users` WHERE tenant_id = ?",
        ["tenant1"],
      );
    });
  });

  describe("scopedInsert", () => {
    it("adds tenant_id to the inserted data", async () => {
      await adapter.scopedInsert("tenant1", "users", { name: "Alice" });
      const [sql, values] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("INSERT INTO `testdb`.`users`");
      expect(values).toContain("tenant1");
      expect(values).toContain("Alice");
    });

    it("overwrites existing tenant_id in data", async () => {
      await adapter.scopedInsert("tenant1", "users", { tenant_id: "wrong", name: "Bob" });
      const [, values] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
      // tenant_id in the spread object gets overwritten by the correct one
      expect(values).toContain("tenant1");
    });
  });

  describe("scopedUpdate", () => {
    it("adds tenant_id to WHERE clause", async () => {
      await adapter.scopedUpdate("tenant1", "users", { name: "Alice" }, { id: 42 });
      expect(pool.query).toHaveBeenCalledWith(
        "UPDATE `testdb`.`users` SET `name` = ? WHERE tenant_id = ? AND `id` = ?",
        ["Alice", "tenant1", 42],
      );
    });
  });

  describe("scopedDelete", () => {
    it("adds tenant_id to WHERE clause", async () => {
      await adapter.scopedDelete("tenant1", "users");
      expect(pool.query).toHaveBeenCalledWith(
        "DELETE FROM `testdb`.`users` WHERE tenant_id = ?",
        ["tenant1"],
      );
    });

    it("includes additional conditions when provided", async () => {
      await adapter.scopedDelete("tenant1", "users", { id: 5 });
      expect(pool.query).toHaveBeenCalledWith(
        "DELETE FROM `testdb`.`users` WHERE tenant_id = ? AND `id` = ?",
        ["tenant1", 5],
      );
    });
  });

  describe("unscopedRawQuery", () => {
    it("passes SQL through without modification", async () => {
      await adapter.unscopedRawQuery("SELECT 1", []);
      expect(pool.query).toHaveBeenCalledWith("SELECT 1", []);
    });

    it("passes SQL without params", async () => {
      await adapter.unscopedRawQuery("SELECT NOW()");
      expect(pool.query).toHaveBeenCalledWith("SELECT NOW()", undefined);
    });
  });

  describe("purgeTenantData", () => {
    it("discovers tables via INFORMATION_SCHEMA and deletes tenant rows", async () => {
      const mockPool = createMockPool();
      // First call returns table list, subsequent calls return delete result
      (mockPool.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([[{ TABLE_NAME: "users" }, { TABLE_NAME: "orders" }], []])
        .mockResolvedValue([{ affectedRows: 3 }, []]);

      const a = new MysqlSharedAdapter({ pool: mockPool, databaseName: "testdb" });
      const result = await a.purgeTenantData("tenant1");

      expect(result.success).toBe(true);
      expect(result.tablesProcessed).toBe(2);
      expect(result.rowsDeleted).toBe(6);
    });

    it("returns success with zero tablesProcessed when no tenant tables exist", async () => {
      const mockPool = createMockPool();
      (mockPool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([[], []]);

      const a = new MysqlSharedAdapter({ pool: mockPool, databaseName: "testdb" });
      const result = await a.purgeTenantData("tenant1");

      expect(result.success).toBe(true);
      expect(result.tablesProcessed).toBe(0);
      expect(result.rowsDeleted).toBe(0);
    });

    it("handles partial failure and reports errors", async () => {
      const mockPool = createMockPool();
      (mockPool.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce([[{ TABLE_NAME: "users" }, { TABLE_NAME: "fail_table" }], []])
        .mockResolvedValueOnce([{ affectedRows: 2 }, []])
        .mockRejectedValueOnce(new Error("delete failed"));

      const a = new MysqlSharedAdapter({ pool: mockPool, databaseName: "testdb" });
      const result = await a.purgeTenantData("tenant1");

      expect(result.success).toBe(false);
      expect(result.errors.length).toBe(1);
      expect(result.tablesProcessed).toBe(1);
    });
  });

  describe("assertTenantId", () => {
    it("throws on empty string", async () => {
      await expect(adapter.scopedSelect("", "users")).rejects.toThrow("Invalid tenantId");
    });
  });

  it("returns shared strategy stats", () => {
    expect(adapter.getStats()).toEqual({ strategy: "shared" });
  });
});
