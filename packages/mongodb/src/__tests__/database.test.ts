import { describe, it, expect, vi, beforeEach } from "vitest";
import { MongoDatabaseAdapter } from "../adapters/database.js";
import type { MongoClientLike, DatabaseLike } from "../types.js";

function createMockDb(): DatabaseLike {
  return {
    collection: vi.fn(),
    collections: vi.fn().mockResolvedValue([]),
    dropDatabase: vi.fn().mockResolvedValue(undefined),
    listCollections: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    }),
  };
}

function createMockClient(): MongoClientLike {
  const db = createMockDb();
  return {
    db: vi.fn().mockReturnValue(db),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe("MongoDatabaseAdapter", () => {
  let createdClients: MongoClientLike[];
  let adapter: MongoDatabaseAdapter;

  beforeEach(() => {
    createdClients = [];
    adapter = new MongoDatabaseAdapter({
      createClient: vi.fn(async () => {
        const client = createMockClient();
        createdClients.push(client);
        return client;
      }),
      baseUri: "mongodb://localhost:27017/default",
      maxClients: 3,
    });
  });

  describe("getDatabase", () => {
    it("returns a database reference for the tenant", async () => {
      const db = await adapter.getDatabase("acme");
      expect(db).toBeDefined();
      expect(createdClients[0].db).toHaveBeenCalledWith("stratum_tenant_acme");
    });

    it("caches clients for repeated access", async () => {
      await adapter.getDatabase("acme");
      await adapter.getDatabase("acme");
      expect(createdClients.length).toBe(1);
    });

    it("validates slug", async () => {
      await expect(adapter.getDatabase("INVALID")).rejects.toThrow(
        "Invalid tenant slug",
      );
    });
  });

  describe("purgeTenantData", () => {
    it("drops the tenant database and removes from pool", async () => {
      await adapter.getDatabase("acme");
      const result = await adapter.purgeTenantData("acme");
      expect(result.success).toBe(true);
    });

    it("returns error result on failure", async () => {
      // Create adapter where db.dropDatabase throws
      const failAdapter = new MongoDatabaseAdapter({
        createClient: vi.fn(async () => {
          const db = createMockDb();
          db.dropDatabase = vi.fn().mockRejectedValue(new Error("drop failed"));
          return {
            db: vi.fn().mockReturnValue(db),
            close: vi.fn().mockResolvedValue(undefined),
          };
        }),
        baseUri: "mongodb://localhost:27017/default",
      });

      const result = await failAdapter.purgeTenantData("acme");
      expect(result.success).toBe(false);
      expect(result.errors.length).toBe(1);
    });
  });

  describe("closeAll", () => {
    it("closes all cached clients", async () => {
      await adapter.getDatabase("acme");
      await adapter.getDatabase("beta");
      await adapter.closeAll();
      for (const client of createdClients) {
        expect(client.close).toHaveBeenCalled();
      }
    });
  });

  it("returns stats", async () => {
    await adapter.getDatabase("acme");
    const stats = adapter.getStats();
    expect(stats.strategy).toBe("database-per-tenant");
    expect(stats.clientCount).toBe(1);
  });
});
