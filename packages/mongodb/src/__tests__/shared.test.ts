import { describe, it, expect, vi, beforeEach } from "vitest";
import { MongoSharedAdapter } from "../adapters/shared.js";
import type { MongoClientLike, DatabaseLike, CollectionLike } from "../types.js";

function createMockCollection(name?: string): CollectionLike {
  return {
    collectionName: name,
    find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    findOne: vi.fn().mockResolvedValue(null),
    insertOne: vi.fn().mockResolvedValue({ insertedId: "id1" }),
    insertMany: vi.fn().mockResolvedValue({ insertedIds: {} }),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    deleteOne: vi.fn().mockResolvedValue({ deletedCount: 0 }),
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 3 }),
    aggregate: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    countDocuments: vi.fn().mockResolvedValue(0),
    distinct: vi.fn().mockResolvedValue([]),
    bulkWrite: vi.fn().mockResolvedValue({}),
    createIndex: vi.fn().mockResolvedValue("idx"),
  };
}

function createMockDb(collections: Record<string, CollectionLike> = {}): DatabaseLike {
  return {
    collection: vi.fn((name: string) => collections[name] ?? createMockCollection(name)),
    collections: vi.fn().mockResolvedValue(Object.values(collections)),
    dropDatabase: vi.fn().mockResolvedValue(undefined),
    listCollections: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue(
        Object.keys(collections).map((name) => ({ name })),
      ),
    }),
  };
}

function createMockClient(db: DatabaseLike): MongoClientLike {
  return {
    db: vi.fn().mockReturnValue(db),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe("MongoSharedAdapter", () => {
  let mockCol: CollectionLike;
  let mockDb: DatabaseLike;
  let adapter: MongoSharedAdapter;

  beforeEach(() => {
    mockCol = createMockCollection("users");
    mockDb = createMockDb({ users: mockCol, orders: createMockCollection("orders") });
    const client = createMockClient(mockDb);
    adapter = new MongoSharedAdapter({ client, databaseName: "testdb" });
  });

  it("returns a scoped collection proxy", () => {
    const scoped = adapter.scopedCollection("tenant1", "users");
    scoped.findOne({ name: "test" });
    expect(mockCol.findOne).toHaveBeenCalledWith({
      name: "test",
      tenant_id: "tenant1",
    });
  });

  describe("purgeTenantData", () => {
    it("deletes tenant data from all collections", async () => {
      const result = await adapter.purgeTenantData("tenant1");
      expect(result.success).toBe(true);
      expect(result.collectionsProcessed).toBe(2);
    });

    it("handles partial failures with Promise.allSettled", async () => {
      const failCol = createMockCollection("fail");
      failCol.deleteMany = vi.fn().mockRejectedValue(new Error("delete failed"));
      const db = createMockDb({ ok: createMockCollection("ok"), fail: failCol });
      const client = createMockClient(db);
      const a = new MongoSharedAdapter({ client, databaseName: "testdb" });

      const result = await a.purgeTenantData("tenant1");
      expect(result.success).toBe(false);
      expect(result.errors.length).toBe(1);
    });

    it("throws for empty tenantId", async () => {
      await expect(adapter.purgeTenantData("")).rejects.toThrow("Invalid tenantId");
    });
  });

  it("returns stats", () => {
    expect(adapter.getStats()).toEqual({ strategy: "shared" });
  });
});
