import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DatabasePoolManager } from "../database/pool-manager.js";

// ---------------------------------------------------------------------------
// Mock pg.Pool
// ---------------------------------------------------------------------------

const mockPoolEnd = vi.fn().mockResolvedValue(undefined);

vi.mock("pg", () => {
  class Pool {
    public database: string;
    public totalCount = 0;
    public idleCount = 0;
    end = mockPoolEnd;

    constructor(config: { database: string }) {
      this.database = config.database;
    }
  }
  return { default: { Pool } };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeManager(maxPools = 3) {
  return new DatabasePoolManager({
    baseConnectionConfig: {
      host: "localhost",
      port: 5432,
      user: "stratum",
      password: "secret",
    },
    maxPools,
    idleTimeoutMs: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DatabasePoolManager", () => {
  beforeEach(() => {
    mockPoolEnd.mockClear();
  });

  describe("slug validation", () => {
    it("rejects slugs starting with a number", () => {
      const mgr = makeManager();
      expect(() => mgr.getPool("123acme")).toThrow("Invalid tenant slug");
    });

    it("rejects slugs with uppercase letters", () => {
      const mgr = makeManager();
      expect(() => mgr.getPool("Acme")).toThrow("Invalid tenant slug");
    });

    it("rejects slugs with hyphens", () => {
      const mgr = makeManager();
      expect(() => mgr.getPool("acme-corp")).toThrow("Invalid tenant slug");
    });

    it("rejects slugs with special characters", () => {
      const mgr = makeManager();
      expect(() => mgr.getPool("acme; DROP TABLE")).toThrow("Invalid tenant slug");
    });

    it("rejects empty slugs", () => {
      const mgr = makeManager();
      expect(() => mgr.getPool("")).toThrow("Invalid tenant slug");
    });

    it("accepts valid lowercase slugs with underscores", () => {
      const mgr = makeManager();
      expect(() => mgr.getPool("acme_corp")).not.toThrow();
    });
  });

  describe("getPool", () => {
    it("creates a new pool for an unseen tenant slug", () => {
      const mgr = makeManager();
      const pool = mgr.getPool("acme");
      expect(pool).toBeDefined();
      expect(mgr.getStats().poolCount).toBe(1);
    });

    it("returns the same pool instance on subsequent calls", () => {
      const mgr = makeManager();
      const pool1 = mgr.getPool("acme");
      const pool2 = mgr.getPool("acme");
      expect(pool1).toBe(pool2);
      expect(mgr.getStats().poolCount).toBe(1);
    });

    it("creates separate pools for different slugs", () => {
      const mgr = makeManager();
      const pool1 = mgr.getPool("acme");
      const pool2 = mgr.getPool("globex");
      expect(pool1).not.toBe(pool2);
      expect(mgr.getStats().poolCount).toBe(2);
    });

    it("connects to the correct database name", () => {
      const mgr = makeManager();
      const pool = mgr.getPool("acme") as unknown as { database: string };
      expect(pool.database).toBe("stratum_tenant_acme");
    });
  });

  describe("LRU eviction", () => {
    it("evicts the least recently used pool when maxPools is exceeded", async () => {
      const mgr = makeManager(2);

      mgr.getPool("tenant_a");
      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 2));
      mgr.getPool("tenant_b");

      // tenant_a is now the LRU entry; adding tenant_c should evict it.
      await new Promise((r) => setTimeout(r, 2));
      mgr.getPool("tenant_c");

      // Allow the async eviction microtask to complete.
      await new Promise((r) => setTimeout(r, 10));

      expect(mockPoolEnd).toHaveBeenCalledTimes(1);
      // poolCount should be back to maxPools (2) after eviction.
      expect(mgr.getStats().poolCount).toBe(2);
    });

    it("updates lastUsed when an existing pool is accessed", async () => {
      const mgr = makeManager(2);

      mgr.getPool("tenant_a");
      await new Promise((r) => setTimeout(r, 2));
      mgr.getPool("tenant_b");
      await new Promise((r) => setTimeout(r, 2));

      // Re-access tenant_a to make it the most recently used.
      mgr.getPool("tenant_a");
      await new Promise((r) => setTimeout(r, 2));

      // Now tenant_b is the LRU; adding tenant_c should evict tenant_b.
      mgr.getPool("tenant_c");
      await new Promise((r) => setTimeout(r, 10));

      expect(mockPoolEnd).toHaveBeenCalledTimes(1);
      // tenant_a and tenant_c should remain.
      expect(mgr.getStats().poolCount).toBe(2);
    });
  });

  describe("closePool", () => {
    it("closes and removes the specified pool", async () => {
      const mgr = makeManager();
      mgr.getPool("acme");
      expect(mgr.getStats().poolCount).toBe(1);

      await mgr.closePool("acme");
      expect(mockPoolEnd).toHaveBeenCalledTimes(1);
      expect(mgr.getStats().poolCount).toBe(0);
    });

    it("is a no-op for unknown slug", async () => {
      const mgr = makeManager();
      await mgr.closePool("nonexistent");
      expect(mockPoolEnd).not.toHaveBeenCalled();
    });
  });

  describe("closeAll", () => {
    it("closes all pools", async () => {
      const mgr = makeManager(10);
      mgr.getPool("a");
      mgr.getPool("b");
      mgr.getPool("c");
      expect(mgr.getStats().poolCount).toBe(3);

      await mgr.closeAll();
      expect(mockPoolEnd).toHaveBeenCalledTimes(3);
      expect(mgr.getStats().poolCount).toBe(0);
    });

    it("is safe to call when no pools exist", async () => {
      const mgr = makeManager();
      await expect(mgr.closeAll()).resolves.toBeUndefined();
      expect(mockPoolEnd).not.toHaveBeenCalled();
    });
  });

  describe("getStats", () => {
    it("returns zero counts for a fresh manager", () => {
      const mgr = makeManager();
      expect(mgr.getStats()).toEqual({ poolCount: 0, activeConnections: 0 });
    });

    it("reflects current pool count", () => {
      const mgr = makeManager(10);
      mgr.getPool("x");
      mgr.getPool("y");
      expect(mgr.getStats().poolCount).toBe(2);
    });
  });
});
