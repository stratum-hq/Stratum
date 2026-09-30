import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MongoPoolManager } from "../pool-manager.js";
import type { MongoClientLike } from "../types.js";

function createMockClient(): MongoClientLike {
  return {
    db: vi.fn().mockReturnValue({}),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe("MongoPoolManager", () => {
  let clients: MongoClientLike[];
  let manager: MongoPoolManager;

  afterEach(async () => {
    vi.useRealTimers();
    await manager.closeAll();
  });

  beforeEach(() => {
    clients = [];
    manager = new MongoPoolManager({
      createClient: vi.fn(async () => {
        const client = createMockClient();
        clients.push(client);
        return client;
      }),
      baseUri: "mongodb://localhost:27017/default",
      maxClients: 3,
    });
  });

  describe("getClient", () => {
    it("creates a new client on first access", async () => {
      const client = await manager.getClient("acme");
      expect(client).toBeDefined();
      expect(clients.length).toBe(1);
    });

    it("returns cached client on repeated access", async () => {
      const first = await manager.getClient("acme");
      const second = await manager.getClient("acme");
      expect(first).toBe(second);
      expect(clients.length).toBe(1);
    });

    it("validates slug", async () => {
      await expect(manager.getClient("INVALID")).rejects.toThrow(
        "Invalid tenant slug",
      );
      await expect(manager.getClient("")).rejects.toThrow(
        "Invalid tenant slug",
      );
      await expect(manager.getClient("has-hyphens")).rejects.toThrow(
        "Invalid tenant slug",
      );
    });
  });

  describe("LRU eviction", () => {
    it("evicts the LRU client when maxClients is reached", async () => {
      // Use fake timers to control lastUsed ordering
      vi.useFakeTimers();

      vi.setSystemTime(1000);
      await manager.getClient("aaa");
      manager.releaseClient("aaa");
      vi.setSystemTime(2000);
      await manager.getClient("bbb");
      manager.releaseClient("bbb");
      vi.setSystemTime(3000);
      await manager.getClient("ccc");
      manager.releaseClient("ccc");

      // Access aaa to make it most recently used
      vi.setSystemTime(4000);
      await manager.getClient("aaa");
      manager.releaseClient("aaa");

      // Adding a 4th should evict bbb (LRU, lastUsed=2000)
      vi.setSystemTime(5000);
      await manager.getClient("ddd");
      expect(clients.length).toBe(4);
      // bbb's client (index 1) should have been closed
      expect(clients[1].close).toHaveBeenCalled();
      expect(manager.getStats().clientCount).toBe(3);

      vi.useRealTimers();
    });

    it("maintains maxClients limit after multiple evictions", async () => {
      for (const slug of ["aaa", "bbb", "ccc", "ddd", "eee"]) {
        await manager.getClient(slug);
        manager.releaseClient(slug);
      }
      expect(manager.getStats().clientCount).toBe(3);
    });
  });

  describe("concurrent first requests", () => {
    it("creates one client when two first requests for a tenant run at the same time", async () => {
      const [first, second] = await Promise.all([
        manager.getClient("acme"),
        manager.getClient("acme"),
      ]);

      expect(first).toBe(second);
      expect(clients.length).toBe(1);
      expect(manager.getStats().clientCount).toBe(1);
    });

    it("counts each concurrent first request as a holder of the client", async () => {
      await Promise.all([manager.getClient("aaa"), manager.getClient("aaa")]);
      manager.releaseClient("aaa");

      for (const slug of ["bbb", "ccc", "ddd"]) {
        await manager.getClient(slug);
        manager.releaseClient(slug);
      }

      expect(clients[0].close).not.toHaveBeenCalled();
    });

    it("rejects every concurrent request when the client cannot be created, then retries", async () => {
      let attempts = 0;
      const failing = new MongoPoolManager({
        createClient: async () => {
          attempts++;
          if (attempts === 1) throw new Error("connect failed");
          return createMockClient();
        },
        baseUri: "mongodb://localhost:27017/default",
      });

      const results = await Promise.allSettled([
        failing.getClient("acme"),
        failing.getClient("acme"),
      ]);

      expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
      expect(failing.getStats().clientCount).toBe(0);
      await expect(failing.getClient("acme")).resolves.toBeDefined();
      expect(attempts).toBe(2);
      await failing.closeAll();
    });
  });

  describe("eviction of clients in use", () => {
    it("never closes a client that a caller has not released", async () => {
      await manager.getClient("aaa");
      await manager.getClient("bbb");
      await manager.getClient("ccc");

      await manager.getClient("ddd");

      for (const client of clients) {
        expect(client.close).not.toHaveBeenCalled();
      }
      expect(manager.getStats().clientCount).toBe(4);
    });

    it("closes a client after its last holder releases it", async () => {
      await manager.getClient("aaa");
      await manager.getClient("bbb");
      await manager.getClient("ccc");
      manager.releaseClient("bbb");

      await manager.getClient("ddd");

      expect(clients[1].close).toHaveBeenCalled();
      expect(clients[0].close).not.toHaveBeenCalled();
      expect(clients[2].close).not.toHaveBeenCalled();
    });
  });

  describe("eviction when close fails", () => {
    it("keeps serving the new tenant when closing the evicted client fails", async () => {
      await manager.getClient("aaa");
      manager.releaseClient("aaa");
      vi.mocked(clients[0].close).mockRejectedValueOnce(new Error("close failed"));
      await manager.getClient("bbb");
      await manager.getClient("ccc");

      const client = await manager.getClient("ddd");

      expect(client).toBe(clients[3]);
      expect(clients[0].close).toHaveBeenCalled();
      expect(manager.getStats().clientCount).toBe(3);
    });
  });

  describe("releaseClient after closeClient", () => {
    it("does not release a new client for a hold on a client that closeClient removed", async () => {
      await manager.getClient("aaa");
      await manager.closeClient("aaa");
      await manager.getClient("aaa");
      await manager.getClient("bbb");
      await manager.getClient("ccc");

      // This release ends the hold on the closed client, not on the new one.
      manager.releaseClient("aaa");
      await manager.getClient("ddd");

      expect(clients[1].close).not.toHaveBeenCalled();
      manager.releaseClient("aaa");
      await manager.getClient("eee");
      expect(clients[1].close).toHaveBeenCalled();
    });

    it("drops the hold of a closed client whose creation failed", async () => {
      let rejectCreate: (err: Error) => void = () => undefined;
      let calls = 0;
      const mgr = new MongoPoolManager({
        createClient: () => {
          calls++;
          if (calls === 1) {
            return new Promise<MongoClientLike>((_resolve, reject) => {
              rejectCreate = reject;
            });
          }
          const client = createMockClient();
          clients.push(client);
          return client;
        },
        baseUri: "mongodb://localhost:27017/default",
        maxClients: 1,
      });
      const pending = mgr.getClient("aaa");
      const closing = mgr.closeClient("aaa");
      rejectCreate(new Error("connect failed"));
      await expect(pending).rejects.toThrow("connect failed");
      await closing;

      await mgr.getClient("aaa");
      mgr.releaseClient("aaa");
      await mgr.getClient("bbb");

      expect(clients[0].close).toHaveBeenCalled();
      await mgr.closeAll();
    });
  });

  describe("idleTimeoutMs validation", () => {
    function makeWithTimeout(idleTimeoutMs: number) {
      return new MongoPoolManager({
        createClient: async () => createMockClient(),
        baseUri: "mongodb://localhost:27017/default",
        idleTimeoutMs,
      });
    }

    it.each([0, Infinity])("starts no idle check when idleTimeoutMs is %s", async (value) => {
      vi.useFakeTimers();
      const mgr = makeWithTimeout(value);

      expect(vi.getTimerCount()).toBe(0);
      await mgr.closeAll();
    });

    it("never closes an idle client when the idle check is off", async () => {
      vi.useFakeTimers();
      const mgr = new MongoPoolManager({
        createClient: async () => {
          const client = createMockClient();
          clients.push(client);
          return client;
        },
        baseUri: "mongodb://localhost:27017/default",
        idleTimeoutMs: 0,
      });
      await mgr.getClient("acme");
      mgr.releaseClient("acme");

      await vi.advanceTimersByTimeAsync(10_000);

      expect(clients[0].close).not.toHaveBeenCalled();
      await mgr.closeAll();
    });

    it("limits the idle check interval to the largest delay a timer accepts", async () => {
      const spy = vi.spyOn(globalThis, "setInterval");
      const mgr = makeWithTimeout(2 ** 31);

      expect(spy).toHaveBeenCalledWith(expect.any(Function), 2 ** 31 - 1);
      spy.mockRestore();
      await mgr.closeAll();
    });

    it.each([-1, Number.NaN])("rejects idleTimeoutMs %s", (value) => {
      expect(() => makeWithTimeout(value)).toThrow(RangeError);
    });
  });

  describe("idle timeout", () => {
    function makeIdleManager() {
      return new MongoPoolManager({
        createClient: async () => {
          const client = createMockClient();
          clients.push(client);
          return client;
        },
        baseUri: "mongodb://localhost:27017/default",
        idleTimeoutMs: 1000,
      });
    }

    it("closes a released client that stays idle longer than idleTimeoutMs, and keeps a held one", async () => {
      vi.useFakeTimers();
      const idle = makeIdleManager();
      await idle.getClient("released");
      idle.releaseClient("released");
      await idle.getClient("held");

      await vi.advanceTimersByTimeAsync(2500);

      expect(clients[0].close).toHaveBeenCalled();
      expect(clients[1].close).not.toHaveBeenCalled();
      expect(idle.getStats().clientCount).toBe(1);
      await idle.closeAll();
    });

    it("survives an idle client whose close fails", async () => {
      vi.useFakeTimers();
      const idle = new MongoPoolManager({
        createClient: async () => ({
          db: vi.fn(),
          close: vi.fn().mockRejectedValue(new Error("close failed")),
        }),
        baseUri: "mongodb://localhost:27017/default",
        idleTimeoutMs: 1000,
      });
      await idle.getClient("acme");
      idle.releaseClient("acme");

      await vi.advanceTimersByTimeAsync(2500);

      expect(idle.getStats().clientCount).toBe(0);
      await idle.closeAll();
    });

    it("stops the idle check when closeAll runs", async () => {
      vi.useFakeTimers();
      const idle = makeIdleManager();
      expect(vi.getTimerCount()).toBe(1);

      await idle.closeAll();

      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe("closeClient", () => {
    it("closes and removes a specific client", async () => {
      await manager.getClient("acme");
      await manager.closeClient("acme");
      expect(clients[0].close).toHaveBeenCalled();
      expect(manager.getStats().clientCount).toBe(0);
    });

    it("is a no-op for unknown slug", async () => {
      await manager.closeClient("unknown");
      expect(manager.getStats().clientCount).toBe(0);
    });
  });

  describe("closeAll", () => {
    it("closes all clients and clears the pool", async () => {
      await manager.getClient("aaa");
      await manager.getClient("bbb");
      await manager.closeAll();
      for (const client of clients) {
        expect(client.close).toHaveBeenCalled();
      }
      expect(manager.getStats().clientCount).toBe(0);
    });
  });

  describe("getStats", () => {
    it("reports correct client count", async () => {
      expect(manager.getStats().clientCount).toBe(0);
      await manager.getClient("acme");
      expect(manager.getStats().clientCount).toBe(1);
    });
  });
});
