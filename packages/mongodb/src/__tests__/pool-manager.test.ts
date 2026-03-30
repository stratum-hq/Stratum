import { describe, it, expect, vi, beforeEach } from "vitest";
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
      vi.setSystemTime(2000);
      await manager.getClient("bbb");
      vi.setSystemTime(3000);
      await manager.getClient("ccc");

      // Access aaa to make it most recently used
      vi.setSystemTime(4000);
      await manager.getClient("aaa");

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
      }
      expect(manager.getStats().clientCount).toBe(3);
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
