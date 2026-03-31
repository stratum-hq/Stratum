import { describe, it, expect, vi, beforeEach } from "vitest";
import { MysqlDatabaseAdapter } from "../adapters/database.js";
import type { MysqlPoolLike } from "../types.js";

function createMockPool(): MysqlPoolLike {
  return {
    getConnection: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue([]),
      release: vi.fn(),
      end: vi.fn().mockResolvedValue(undefined),
    }),
    query: vi.fn().mockResolvedValue(undefined),
    end: vi.fn().mockResolvedValue(undefined),
  };
}

describe("MysqlDatabaseAdapter", () => {
  let createdPools: MysqlPoolLike[];
  let adapter: MysqlDatabaseAdapter;

  beforeEach(() => {
    createdPools = [];
    adapter = new MysqlDatabaseAdapter({
      createPool: vi.fn(async () => {
        const pool = createMockPool();
        createdPools.push(pool);
        return pool;
      }),
      baseUri: "mysql://localhost:3306/default",
      maxPools: 3,
    });
  });

  describe("getPool", () => {
    it("returns a pool for the tenant database", async () => {
      const pool = await adapter.getPool("acme");
      expect(pool).toBeDefined();
      expect(createdPools.length).toBe(1);
    });

    it("caches pools for repeated access", async () => {
      const first = await adapter.getPool("acme");
      const second = await adapter.getPool("acme");
      expect(first).toBe(second);
      expect(createdPools.length).toBe(1);
    });

    it("validates slug and rejects invalid values", async () => {
      await expect(adapter.getPool("INVALID")).rejects.toThrow("Invalid tenant slug");
      await expect(adapter.getPool("has-hyphens")).rejects.toThrow("Invalid tenant slug");
      await expect(adapter.getPool("")).rejects.toThrow("Invalid tenant slug");
    });
  });

  describe("purgeTenantData", () => {
    it("drops the tenant database and closes the pool", async () => {
      await adapter.getPool("acme");
      const result = await adapter.purgeTenantData("acme");

      expect(createdPools[0].query).toHaveBeenCalledWith(
        "DROP DATABASE IF EXISTS `stratum_tenant_acme`",
      );
      expect(result.success).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it("returns error result when drop fails", async () => {
      const failAdapter = new MysqlDatabaseAdapter({
        createPool: vi.fn(async () => {
          const pool = createMockPool();
          (pool.query as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("drop failed"));
          return pool;
        }),
        baseUri: "mysql://localhost:3306/default",
      });

      const result = await failAdapter.purgeTenantData("acme");
      expect(result.success).toBe(false);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].table).toBe("*");
    });
  });

  describe("closeAll", () => {
    it("delegates to pool manager and closes all pools", async () => {
      await adapter.getPool("acme");
      await adapter.getPool("beta");
      await adapter.closeAll();
      for (const pool of createdPools) {
        expect(pool.end).toHaveBeenCalled();
      }
    });
  });

  describe("getStats", () => {
    it("returns strategy and pool count", async () => {
      await adapter.getPool("acme");
      const stats = adapter.getStats();
      expect(stats.strategy).toBe("database-per-tenant");
      expect(stats.poolCount).toBe(1);
    });
  });
});
