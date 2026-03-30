import { describe, it, expect, vi, beforeEach } from "vitest";
import { MongoCollectionAdapter } from "../adapters/collection.js";
import type { MongoClientLike, DatabaseLike, CollectionLike } from "../types.js";

function createMockCollection(name: string): CollectionLike {
  return {
    collectionName: name,
    find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    findOne: vi.fn().mockResolvedValue(null),
    insertOne: vi.fn().mockResolvedValue({ insertedId: "id1" }),
    insertMany: vi.fn().mockResolvedValue({ insertedIds: {} }),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    deleteOne: vi.fn().mockResolvedValue({ deletedCount: 0 }),
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
    aggregate: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    countDocuments: vi.fn().mockResolvedValue(0),
    distinct: vi.fn().mockResolvedValue([]),
    bulkWrite: vi.fn().mockResolvedValue({}),
    createIndex: vi.fn().mockResolvedValue("idx"),
  };
}

function createMockDb(): DatabaseLike {
  return {
    collection: vi.fn((name: string) => createMockCollection(name)),
    collections: vi.fn().mockResolvedValue([]),
    dropDatabase: vi.fn().mockResolvedValue(undefined),
    listCollections: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { name: "users_acme" },
        { name: "orders_acme" },
        { name: "users_other" },
      ]),
    }),
  };
}

function createMockClient(db: DatabaseLike): MongoClientLike {
  return {
    db: vi.fn().mockReturnValue(db),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe("MongoCollectionAdapter", () => {
  let mockDb: DatabaseLike;
  let adapter: MongoCollectionAdapter;

  beforeEach(() => {
    mockDb = createMockDb();
    const client = createMockClient(mockDb);
    adapter = new MongoCollectionAdapter({ client, databaseName: "testdb" });
  });

  describe("scopedCollection", () => {
    it("returns collection with correct naming convention", () => {
      adapter.scopedCollection("acme", "users");
      expect(mockDb.collection).toHaveBeenCalledWith("users_acme");
    });

    it("validates the tenant slug", () => {
      expect(() => adapter.scopedCollection("INVALID", "users")).toThrow(
        "Invalid tenant slug",
      );
    });

    it("rejects slugs with hyphens", () => {
      expect(() => adapter.scopedCollection("my-tenant", "users")).toThrow(
        "Invalid tenant slug",
      );
    });

    it("rejects empty slug", () => {
      expect(() => adapter.scopedCollection("", "users")).toThrow(
        "Invalid tenant slug",
      );
    });
  });

  describe("purgeTenantData", () => {
    it("identifies collections by suffix", async () => {
      const result = await adapter.purgeTenantData("acme");
      // Should process users_acme and orders_acme, not users_other
      expect(result.collectionsProcessed).toBe(2);
      expect(result.success).toBe(true);
    });

    it("rejects invalid slugs", async () => {
      await expect(adapter.purgeTenantData("INVALID")).rejects.toThrow(
        "Invalid tenant slug",
      );
    });
  });

  it("returns stats", () => {
    expect(adapter.getStats()).toEqual({ strategy: "collection-per-tenant" });
  });
});
