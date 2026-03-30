import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTenantScopedCollection } from "../adapters/shared.js";
import type { CollectionLike } from "../types.js";

function createMockCollection(): CollectionLike {
  return {
    find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    findOne: vi.fn().mockResolvedValue(null),
    insertOne: vi.fn().mockResolvedValue({ insertedId: "id1" }),
    insertMany: vi.fn().mockResolvedValue({ insertedIds: { 0: "id1" } }),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    updateMany: vi.fn().mockResolvedValue({ modifiedCount: 2 }),
    deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 5 }),
    aggregate: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    countDocuments: vi.fn().mockResolvedValue(10),
    distinct: vi.fn().mockResolvedValue(["a", "b"]),
    bulkWrite: vi.fn().mockResolvedValue({}),
    createIndex: vi.fn().mockResolvedValue("index_name"),
  };
}

describe("createTenantScopedCollection", () => {
  let mock: CollectionLike;
  let scoped: CollectionLike;
  const tenantId = "tenant_abc";

  beforeEach(() => {
    mock = createMockCollection();
    scoped = createTenantScopedCollection(mock, tenantId);
  });

  describe("tenant_id injection", () => {
    it("injects tenant_id into find filter", () => {
      scoped.find({ status: "active" });
      expect(mock.find).toHaveBeenCalledWith(
        { status: "active", tenant_id: tenantId },
        undefined,
      );
    });

    it("injects tenant_id into find with no filter", () => {
      scoped.find();
      expect(mock.find).toHaveBeenCalledWith(
        { tenant_id: tenantId },
        undefined,
      );
    });

    it("injects tenant_id into findOne filter", () => {
      scoped.findOne({ name: "test" });
      expect(mock.findOne).toHaveBeenCalledWith({
        name: "test",
        tenant_id: tenantId,
      });
    });

    it("injects tenant_id into insertOne document", () => {
      scoped.insertOne({ name: "item" });
      expect(mock.insertOne).toHaveBeenCalledWith({
        name: "item",
        tenant_id: tenantId,
      });
    });

    it("injects tenant_id into insertMany documents", () => {
      scoped.insertMany([{ name: "a" }, { name: "b" }]);
      expect(mock.insertMany).toHaveBeenCalledWith([
        { name: "a", tenant_id: tenantId },
        { name: "b", tenant_id: tenantId },
      ]);
    });

    it("injects tenant_id into updateOne filter", () => {
      scoped.updateOne({ _id: "1" }, { $set: { name: "x" } });
      expect(mock.updateOne).toHaveBeenCalledWith(
        { _id: "1", tenant_id: tenantId },
        { $set: { name: "x" } },
        undefined,
      );
    });

    it("injects tenant_id into updateMany filter", () => {
      scoped.updateMany({ status: "old" }, { $set: { status: "new" } });
      expect(mock.updateMany).toHaveBeenCalledWith(
        { status: "old", tenant_id: tenantId },
        { $set: { status: "new" } },
        undefined,
      );
    });

    it("injects tenant_id into deleteOne filter", () => {
      scoped.deleteOne({ _id: "1" });
      expect(mock.deleteOne).toHaveBeenCalledWith({
        _id: "1",
        tenant_id: tenantId,
      });
    });

    it("injects tenant_id into deleteMany filter", () => {
      scoped.deleteMany({ archived: true });
      expect(mock.deleteMany).toHaveBeenCalledWith({
        archived: true,
        tenant_id: tenantId,
      });
    });

    it("prepends $match stage in aggregate", () => {
      scoped.aggregate([{ $group: { _id: "$status" } }]);
      expect(mock.aggregate).toHaveBeenCalledWith([
        { $match: { tenant_id: tenantId } },
        { $group: { _id: "$status" } },
      ]);
    });

    it("injects tenant_id into countDocuments filter", () => {
      scoped.countDocuments({ active: true });
      expect(mock.countDocuments).toHaveBeenCalledWith({
        active: true,
        tenant_id: tenantId,
      });
    });

    it("injects tenant_id into distinct filter", () => {
      scoped.distinct("category", { active: true });
      expect(mock.distinct).toHaveBeenCalledWith("category", {
        active: true,
        tenant_id: tenantId,
      });
    });

    it("injects tenant_id into bulkWrite operations", () => {
      scoped.bulkWrite([
        { insertOne: { document: { name: "a" } } },
        { updateOne: { filter: { _id: "1" }, update: { $set: { x: 1 } } } },
      ]);
      expect(mock.bulkWrite).toHaveBeenCalledWith([
        { insertOne: { document: { name: "a", tenant_id: tenantId } } },
        {
          updateOne: {
            filter: { _id: "1", tenant_id: tenantId },
            update: { $set: { x: 1 } },
          },
        },
      ]);
    });

    it("passes createIndex through without modification", () => {
      scoped.createIndex({ name: 1 }, { unique: true });
      expect(mock.createIndex).toHaveBeenCalledWith({ name: 1 }, { unique: true });
    });
  });

  describe("fail-closed behavior", () => {
    it("throws for unknown methods", () => {
      const proxy = scoped as unknown as Record<string, () => void>;
      expect(() => proxy.drop()).toThrow(
        "Method 'drop' is not supported on tenant-scoped collections",
      );
    });

    it("throws for rename method", () => {
      const proxy = scoped as unknown as Record<string, () => void>;
      expect(() => proxy.rename()).toThrow(
        "Method 'rename' is not supported on tenant-scoped collections",
      );
    });
  });

  describe("tenantId validation", () => {
    it("throws for null tenantId", () => {
      expect(() =>
        createTenantScopedCollection(mock, null as unknown as string),
      ).toThrow("Invalid tenantId");
    });

    it("throws for undefined tenantId", () => {
      expect(() =>
        createTenantScopedCollection(mock, undefined as unknown as string),
      ).toThrow("Invalid tenantId");
    });

    it("throws for empty string tenantId", () => {
      expect(() => createTenantScopedCollection(mock, "")).toThrow(
        "Invalid tenantId",
      );
    });
  });
});
