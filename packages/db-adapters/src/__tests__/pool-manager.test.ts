import { describe, it, expect, vi, beforeEach } from "vitest";
import { DatabasePoolManager } from "../database/pool-manager.js";

// ---------------------------------------------------------------------------
// Mock pg.Pool
// ---------------------------------------------------------------------------

const mockPoolEnd = vi.fn().mockResolvedValue(undefined);
const createdDatabases: string[] = [];
const createdConfigs: Array<{ database: string; connectionString?: string }> = [];

vi.mock("pg", () => {
  class Pool {
    public database: string;
    public totalCount = 0;
    public idleCount = 0;
    end = () => mockPoolEnd(this.database);

    constructor(config: { database: string; connectionString?: string }) {
      this.database = config.database;
      createdDatabases.push(config.database);
      createdConfigs.push(config);
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
    createdDatabases.length = 0;
    createdConfigs.length = 0;
  });

  describe("slug validation", () => {
    it("rejects slugs starting with a number", async () => {
      const mgr = makeManager();
      await expect(mgr.getPool("123acme")).rejects.toThrow("Invalid tenant slug");
    });

    it("rejects slugs with uppercase letters", async () => {
      const mgr = makeManager();
      await expect(mgr.getPool("Acme")).rejects.toThrow("Invalid tenant slug");
    });

    it("rejects slugs with hyphens", async () => {
      const mgr = makeManager();
      await expect(mgr.getPool("acme-corp")).rejects.toThrow("Invalid tenant slug");
    });

    it("rejects slugs with special characters", async () => {
      const mgr = makeManager();
      await expect(mgr.getPool("acme; DROP TABLE")).rejects.toThrow("Invalid tenant slug");
    });

    it("rejects empty slugs", async () => {
      const mgr = makeManager();
      await expect(mgr.getPool("")).rejects.toThrow("Invalid tenant slug");
    });

    it("rejects slugs whose database name would exceed 63 bytes", async () => {
      const manager = makeManager();
      await expect(manager.getPool("a".repeat(49))).rejects.toThrow(/exceeds 63 bytes/);
    });

    it("accepts valid lowercase slugs with underscores", async () => {
      const mgr = makeManager();
      await expect(mgr.getPool("acme_corp")).resolves.toBeDefined();
    });
  });

  describe("getPool", () => {
    it("creates a new pool for an unseen tenant slug", async () => {
      const mgr = makeManager();
      const pool = await mgr.getPool("acme");
      expect(pool).toBeDefined();
      expect(mgr.getStats().poolCount).toBe(1);
    });

    it("returns the same pool instance on subsequent calls", async () => {
      const mgr = makeManager();
      const pool1 = await mgr.getPool("acme");
      const pool2 = await mgr.getPool("acme");
      expect(pool1).toBe(pool2);
      expect(mgr.getStats().poolCount).toBe(1);
    });

    it("creates separate pools for different slugs", async () => {
      const mgr = makeManager();
      const pool1 = await mgr.getPool("acme");
      const pool2 = await mgr.getPool("globex");
      expect(pool1).not.toBe(pool2);
      expect(mgr.getStats().poolCount).toBe(2);
    });

    it("connects to the correct database name", async () => {
      const mgr = makeManager();
      const pool = (await mgr.getPool("acme")) as unknown as { database: string };
      expect(pool.database).toBe("stratum_tenant_acme");
    });
  });

  describe("baseConnectionConfig with a connectionString", () => {
    // pg reads the database name from connectionString before `database`, so
    // the tenant's name must be in the connection string the pool gets.
    function managerWith(connectionString: string) {
      return new DatabasePoolManager({ baseConnectionConfig: { connectionString } });
    }

    it("names each tenant's database in the connection string of its pool", async () => {
      const mgr = managerWith("postgresql://app:secret@db.internal:5433/main?sslmode=require");
      await mgr.getPool("acme");
      await mgr.getPool("globex");
      const urls = createdConfigs.map((c) => new URL(c.connectionString!));
      expect(urls.map((u) => u.pathname)).toEqual(["/stratum_tenant_acme", "/stratum_tenant_globex"]);
      for (const u of urls) {
        expect(u.host).toBe("db.internal:5433");
        expect(u.username).toBe("app");
        expect(u.password).toBe("secret");
        expect(u.searchParams.get("sslmode")).toBe("require");
      }
    });

    it("names the tenant's database in a socket connection string", async () => {
      await managerWith("/var/run/postgresql main").getPool("acme");
      await managerWith("socket:/var/run/postgresql?db=main&encoding=utf8").getPool("acme");
      expect(createdConfigs[0].connectionString).toBe("/var/run/postgresql stratum_tenant_acme");
      const socket = new URL(createdConfigs[1].connectionString!);
      expect(socket.searchParams.get("db")).toBe("stratum_tenant_acme");
      expect(socket.searchParams.get("encoding")).toBe("utf8");
    });

    it("refuses a connection string it cannot set the database name in", () => {
      expect(() => managerWith("not a connection string")).toThrow(/connectionString/);
    });
  });

  describe("LRU eviction", () => {
    it("evicts the least recently used pool when maxPools is exceeded", async () => {
      const mgr = makeManager(2);

      await mgr.getPool("tenant_a");
      mgr.releasePool("tenant_a");
      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 2));
      await mgr.getPool("tenant_b");
      mgr.releasePool("tenant_b");

      // tenant_a is now the LRU entry; adding tenant_c should evict it.
      await new Promise((r) => setTimeout(r, 2));
      await mgr.getPool("tenant_c");

      expect(mockPoolEnd).toHaveBeenCalledTimes(1);
      // poolCount should be back to maxPools (2) after eviction.
      expect(mgr.getStats().poolCount).toBe(2);
    });

    it("updates lastUsed when an existing pool is accessed", async () => {
      const mgr = makeManager(2);

      await mgr.getPool("tenant_a");
      mgr.releasePool("tenant_a");
      await new Promise((r) => setTimeout(r, 2));
      await mgr.getPool("tenant_b");
      mgr.releasePool("tenant_b");
      await new Promise((r) => setTimeout(r, 2));

      // Re-access tenant_a to make it the most recently used.
      await mgr.getPool("tenant_a");
      mgr.releasePool("tenant_a");
      await new Promise((r) => setTimeout(r, 2));

      // Now tenant_b is the LRU; adding tenant_c should evict tenant_b.
      await mgr.getPool("tenant_c");

      expect(mockPoolEnd).toHaveBeenCalledTimes(1);
      expect(mockPoolEnd).toHaveBeenCalledWith("stratum_tenant_tenant_b");
      // tenant_a and tenant_c should remain.
      expect(mgr.getStats().poolCount).toBe(2);
    });
  });

  describe("concurrent first requests", () => {
    it("creates one pool when two first requests for a tenant run at the same time", async () => {
      const mgr = makeManager(1);
      // A full manager makes getPool wait for an eviction before it creates the pool.
      await mgr.getPool("tenant_a");
      mgr.releasePool("tenant_a");

      const [first, second] = await Promise.all([
        mgr.getPool("tenant_b"),
        mgr.getPool("tenant_b"),
      ]);

      expect(first).toBe(second);
      expect(createdDatabases.filter((db) => db === "stratum_tenant_tenant_b")).toHaveLength(1);
      expect(mgr.getStats().poolCount).toBe(1);
    });

    it("counts each concurrent first request as a holder of the pool", async () => {
      const mgr = makeManager(1);
      await Promise.all([mgr.getPool("tenant_a"), mgr.getPool("tenant_a")]);
      mgr.releasePool("tenant_a");

      await mgr.getPool("tenant_b");

      expect(mockPoolEnd).not.toHaveBeenCalled();
    });
  });

  describe("eviction of pools in use", () => {
    it("never ends a pool that a caller has not released", async () => {
      const mgr = makeManager(1);
      await mgr.getPool("tenant_a");

      await mgr.getPool("tenant_b");

      expect(mockPoolEnd).not.toHaveBeenCalled();
      expect(mgr.getStats().poolCount).toBe(2);
    });

    it("ends a pool after its last holder releases it", async () => {
      const mgr = makeManager(1);
      await mgr.getPool("tenant_a");
      await mgr.getPool("tenant_a");
      mgr.releasePool("tenant_a");
      await mgr.getPool("tenant_b");
      expect(mockPoolEnd).not.toHaveBeenCalled();

      mgr.releasePool("tenant_a");
      mgr.releasePool("tenant_b");
      await mgr.getPool("tenant_c");

      expect(mockPoolEnd).toHaveBeenCalledWith("stratum_tenant_tenant_a");
    });

    it("keeps pools for the same slug in different regions apart", async () => {
      const mgr = makeManager(1);
      await mgr.getPool("acme", "eu");

      await mgr.getPool("acme", "us");

      expect(mockPoolEnd).not.toHaveBeenCalled();
      mgr.releasePool("acme", "eu");
      await mgr.getPool("globex");
      expect(mockPoolEnd).toHaveBeenCalledTimes(1);
    });

    it("keeps serving the new tenant when ending the evicted pool fails", async () => {
      const mgr = makeManager(1);
      await mgr.getPool("tenant_a");
      mgr.releasePool("tenant_a");
      mockPoolEnd.mockRejectedValueOnce(new Error("end failed"));

      const pool = (await mgr.getPool("tenant_b")) as unknown as { database: string };

      expect(pool.database).toBe("stratum_tenant_tenant_b");
      expect(mgr.getStats().poolCount).toBe(1);
      mgr.releasePool("tenant_b");
      await mgr.getPool("tenant_c");
      expect(mockPoolEnd).toHaveBeenLastCalledWith("stratum_tenant_tenant_b");
    });
  });

  describe("releasePool", () => {
    it("releases a region-prefixed pool when called with the bare slug", async () => {
      const mgr = makeManager(1);
      await mgr.getPool("acme", "eu");

      mgr.releasePool("acme");
      await mgr.getPool("globex");

      expect(mockPoolEnd).toHaveBeenCalledWith("stratum_tenant_acme");
    });

    it("releases nothing when the bare slug matches pools in more than one region", async () => {
      const mgr = makeManager(2);
      await mgr.getPool("acme", "eu");
      await mgr.getPool("acme", "us");

      mgr.releasePool("acme");
      await mgr.getPool("globex");

      expect(mockPoolEnd).not.toHaveBeenCalled();
    });

    it("does not release a new pool for a hold on a pool that closePool removed", async () => {
      const mgr = makeManager(1);
      await mgr.getPool("acme");
      await mgr.closePool("acme");
      await mgr.getPool("acme");
      mockPoolEnd.mockClear();

      // This release ends the hold on the closed pool, not on the new one.
      mgr.releasePool("acme");
      await mgr.getPool("globex");

      expect(mockPoolEnd).not.toHaveBeenCalled();
      mgr.releasePool("acme");
      await mgr.getPool("initech");
      expect(mockPoolEnd).toHaveBeenCalledWith("stratum_tenant_acme");
    });
  });

  describe("closePool", () => {
    it("closes and removes the specified pool", async () => {
      const mgr = makeManager();
      await mgr.getPool("acme");
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
      await mgr.getPool("a");
      await mgr.getPool("b");
      await mgr.getPool("c");
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

    it("reflects current pool count", async () => {
      const mgr = makeManager(10);
      await mgr.getPool("x");
      await mgr.getPool("y");
      expect(mgr.getStats().poolCount).toBe(2);
    });
  });
});
