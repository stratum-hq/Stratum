import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MysqlPoolManager } from "../pool-manager.js";
import type { MysqlPoolLike } from "../types.js";

function createMockPool(): MysqlPoolLike {
  return {
    getConnection: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue([]),
      release: vi.fn(),
      end: vi.fn().mockResolvedValue(undefined),
    }),
    query: vi.fn().mockResolvedValue([]),
    end: vi.fn().mockResolvedValue(undefined),
  };
}

describe("MysqlPoolManager", () => {
  let pools: MysqlPoolLike[];
  let manager: MysqlPoolManager;

  beforeEach(() => {
    pools = [];
    manager = new MysqlPoolManager({
      createPool: vi.fn(async () => {
        const pool = createMockPool();
        pools.push(pool);
        return pool;
      }),
      baseUri: "mysql://localhost:3306/default",
      maxPools: 3,
    });
  });

  afterEach(async () => {
    await manager.closeAll();
    vi.useRealTimers();
  });

  describe("getPool", () => {
    it("creates a pool on first access", async () => {
      const pool = await manager.getPool("acme");
      expect(pool).toBeDefined();
      expect(pools.length).toBe(1);
    });

    it("returns cached pool on second access", async () => {
      const first = await manager.getPool("acme");
      const second = await manager.getPool("acme");
      expect(first).toBe(second);
      expect(pools.length).toBe(1);
    });

    it("evicts LRU pool when at capacity", async () => {
      vi.useFakeTimers();

      vi.setSystemTime(1000);
      await manager.getPool("aaa");
      manager.releasePool("aaa");

      vi.setSystemTime(2000);
      await manager.getPool("bbb");
      manager.releasePool("bbb");

      vi.setSystemTime(3000);
      await manager.getPool("ccc");
      manager.releasePool("ccc");

      // Access aaa to make it most recently used
      vi.setSystemTime(4000);
      await manager.getPool("aaa");
      manager.releasePool("aaa");

      // Adding a 4th should evict bbb (LRU with lastUsed=2000)
      vi.setSystemTime(5000);
      await manager.getPool("ddd");

      expect(pools.length).toBe(4);
      // bbb (index 1) should have been closed
      expect(pools[1].end).toHaveBeenCalled();
      expect(manager.getStats().poolCount).toBe(3);
    });

    it("skips busy pools (refCount > 0) during eviction", async () => {
      vi.useFakeTimers();

      vi.setSystemTime(1000);
      await manager.getPool("aaa");
      // do NOT release aaa — refCount remains > 0

      vi.setSystemTime(2000);
      await manager.getPool("bbb");
      manager.releasePool("bbb");

      vi.setSystemTime(3000);
      await manager.getPool("ccc");
      manager.releasePool("ccc");

      // aaa is busy, so eviction should pick bbb (oldest idle)
      vi.setSystemTime(4000);
      await manager.getPool("ddd");

      // aaa should NOT have been closed since it was busy
      expect(pools[0].end).not.toHaveBeenCalled();
      // bbb (index 1) should have been evicted
      expect(pools[1].end).toHaveBeenCalled();
    });
  });

  describe("releasePool", () => {
    it("decrements refCount for the pool", async () => {
      await manager.getPool("acme"); // refCount = 1
      manager.releasePool("acme");   // refCount = 0
      // Should be evictable now — create 3 more to trigger eviction
      manager.releasePool("acme"); // no-op when already 0
      expect(manager.getStats().poolCount).toBe(1);
    });

    it("is a no-op for unknown slug", () => {
      expect(() => manager.releasePool("unknown")).not.toThrow();
    });
  });

  describe("closePool", () => {
    it("closes and removes the pool", async () => {
      await manager.getPool("acme");
      await manager.closePool("acme");
      expect(pools[0].end).toHaveBeenCalled();
      expect(manager.getStats().poolCount).toBe(0);
    });

    it("is a no-op for unknown slug", async () => {
      await manager.closePool("unknown");
      expect(manager.getStats().poolCount).toBe(0);
    });
  });

  describe("closeAll", () => {
    it("closes all pools and clears the pool map", async () => {
      await manager.getPool("aaa");
      await manager.getPool("bbb");
      await manager.closeAll();
      for (const pool of pools) {
        expect(pool.end).toHaveBeenCalled();
      }
      expect(manager.getStats().poolCount).toBe(0);
    });
  });

  describe("getStats", () => {
    it("returns correct pool count", async () => {
      expect(manager.getStats().poolCount).toBe(0);
      await manager.getPool("acme");
      expect(manager.getStats().poolCount).toBe(1);
      await manager.getPool("beta");
      expect(manager.getStats().poolCount).toBe(2);
    });
  });

  describe("slug validation", () => {
    it("rejects invalid slugs", async () => {
      await expect(manager.getPool("INVALID")).rejects.toThrow("Invalid tenant slug");
      await expect(manager.getPool("has-hyphens")).rejects.toThrow("Invalid tenant slug");
      await expect(manager.getPool("")).rejects.toThrow("Invalid tenant slug");
    });
  });

  describe("idle timeout", () => {
    it("closes unused pools after idle timeout elapses", async () => {
      vi.useFakeTimers();
      // Start at t=0 so the pool's lastUsed is recorded at 0
      vi.setSystemTime(0);

      const idleManager = new MysqlPoolManager({
        createPool: vi.fn(async () => {
          const pool = createMockPool();
          pools.push(pool);
          return pool;
        }),
        baseUri: "mysql://localhost:3306/default",
        idleTimeoutMs: 5000,
      });

      await idleManager.getPool("acme");
      idleManager.releasePool("acme"); // make it idle (refCount = 0, lastUsed = 0)

      // The interval fires at t=5000 (cutoff=0, lastUsed=0: 0<0 false) and t=10000
      // (cutoff=5000, lastUsed=0: 0<5000 true). Advance past the second fire.
      await vi.advanceTimersByTimeAsync(10001);
      // Await the async cleanup that was triggered by the interval
      await idleManager._lastCleanup;

      expect(pools[0].end).toHaveBeenCalled();
      expect(idleManager.getStats().poolCount).toBe(0);

      await idleManager.closeAll();
    });
  });
});
