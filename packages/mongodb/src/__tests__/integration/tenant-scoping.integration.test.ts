import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { getTestClient, getTestDbName, cleanupTestClient } from "./setup.js";
import { MongoSharedAdapter } from "../../adapters/shared.js";
import type { MongoClient } from "mongodb";
import type { MongoClientLike, CollectionLike } from "../../types.js";

const dbName = `${getTestDbName()}_scoping`;
let client: MongoClient;
let adapter: MongoSharedAdapter;
let colA: CollectionLike;
let colB: CollectionLike;

beforeEach(async () => {
  client = await getTestClient();
  adapter = new MongoSharedAdapter({
    client: client as unknown as MongoClientLike,
    databaseName: dbName,
  });
  colA = adapter.scopedCollection("tenant-a", "orders");
  colB = adapter.scopedCollection("tenant-b", "orders");
  await colB.insertOne({ name: "b-order" });
  await adapter.scopedCollection("tenant-b", "customers").insertOne({ name: "b-customer" });
  await colA.insertOne({ name: "a-order" });
});

afterEach(async () => {
  await client.db(dbName).dropDatabase();
});

afterAll(async () => {
  await cleanupTestClient();
});

/** Runs an operation that may be rejected (synchronously or not); rejection is an acceptable outcome. */
async function attempt(fn: () => unknown): Promise<void> {
  try {
    await fn();
  } catch {
    // rejected
  }
}

async function rawDocs(collection: string): Promise<Array<Record<string, unknown>>> {
  return client.db(dbName).collection(collection).find({}).toArray() as Promise<Array<Record<string, unknown>>>;
}

describe("aggregate pipeline validation (shared-collection proxy)", () => {
  const nestedPipelines: Array<[string, Record<string, unknown>[]]> = [
    ["$lookup inside $facet", [{ $facet: { x: [{ $lookup: { from: "customers", pipeline: [], as: "all" } }] } }]],
    ["$unionWith inside $facet", [{ $facet: { x: [{ $unionWith: { coll: "customers" } }] } }]],
    ["$graphLookup inside $facet", [
      { $facet: { x: [{ $graphLookup: { from: "customers", startWith: "$name", connectFromField: "name", connectToField: "name", as: "g" } }] } },
    ]],
    ["$out inside $facet", [{ $facet: { x: [{ $out: "leak" }] } }]],
  ];

  for (const [label, pipeline] of nestedPipelines) {
    it(`rejects ${label}`, () => {
      expect(() => colA.aggregate(pipeline)).toThrow(/blocked/);
    });
  }

  it("allows a $facet made only of safe stages and keeps it tenant-scoped", async () => {
    const [res] = (await colA
      .aggregate([{ $facet: { names: [{ $project: { _id: 0, name: 1 } }] } }])
      .toArray()) as Array<{ names: Array<{ name: string }> }>;
    expect(res.names).toEqual([{ name: "a-order" }]);
  });

  it("does not expose cursor methods that append stages after validation", () => {
    const cursor = colA.aggregate([]) as unknown as Record<string, (...a: unknown[]) => unknown>;
    expect(() => cursor.lookup({ from: "customers", pipeline: [], as: "all" })).toThrow();
    expect(() => cursor.addStage({ $unionWith: { coll: "customers" } })).toThrow();
  });

  it("aggregate cursor still returns only the current tenant's documents", async () => {
    const docs = (await colA.aggregate([{ $project: { name: 1 } }]).toArray()) as Array<{ name: string }>;
    expect(docs.map((d) => d.name)).toEqual(["a-order"]);
  });
});

describe("find cursor (shared-collection proxy)", () => {
  it("does not allow the tenant filter to be replaced on the returned cursor", async () => {
    const cursor = colA.find({}) as unknown as { filter(f: unknown): { toArray(): Promise<unknown[]> } };
    let docs: Array<{ name: string }> = [];
    try {
      docs = (await cursor.filter({}).toArray()) as Array<{ name: string }>;
    } catch {
      // Rejecting the call is an acceptable outcome.
    }
    expect(docs.every((d) => d.name === "a-order")).toBe(true);
  });

  it("find cursor still supports sort/limit/project/toArray", async () => {
    await colA.insertOne({ name: "a-order-2" });
    const docs = (await (colA.find({}) as unknown as {
      sort(s: unknown): { limit(n: number): { project(p: unknown): { toArray(): Promise<unknown[]> } } };
    })
      .sort({ name: -1 })
      .limit(1)
      .project({ _id: 0, name: 1 })
      .toArray()) as Array<{ name: string }>;
    expect(docs).toEqual([{ name: "a-order-2" }]);
  });
});

describe("bulkWrite (shared-collection proxy)", () => {
  it("assigns the current tenant to insertOne operations in the short form", async () => {
    await attempt(() => colA.bulkWrite([{ insertOne: { name: "short-form", tenant_id: "tenant-b" } }]));
    const planted = (await rawDocs("orders")).filter((d) => d.name === "short-form");
    for (const d of planted) expect(d.tenant_id).toBe("tenant-a");
  });

  it("rejects unknown bulkWrite operation types", async () => {
    await expect(
      Promise.resolve().then(() => colA.bulkWrite([{ someOp: { filter: {} } }])),
    ).rejects.toThrow();
  });

  it("rejects filter-bearing bulkWrite operations without a filter", async () => {
    await expect(
      Promise.resolve().then(() => colA.bulkWrite([{ deleteMany: {} }])),
    ).rejects.toThrow();
    expect((await rawDocs("orders")).filter((d) => d.tenant_id === "tenant-b")).toHaveLength(1);
  });
});

describe("update sanitization (shared-collection proxy)", () => {
  it("does not let an upsert with $setOnInsert create a document in another tenant", async () => {
    await colA.updateOne(
      { name: "upserted" },
      { $setOnInsert: { tenant_id: "tenant-b" } },
      { upsert: true },
    );
    const docs = (await rawDocs("orders")).filter((d) => d.name === "upserted");
    expect(docs).toHaveLength(1);
    expect(docs[0].tenant_id).toBe("tenant-a");
  });

  it("does not let $rename move a field onto tenant_id", async () => {
    await colA.updateOne({ name: "a-order" }, { $set: { note: "tenant-b" } });
    await attempt(() => colA.updateOne({ name: "a-order" }, { $rename: { note: "tenant_id" } }));
    const docs = (await rawDocs("orders")).filter((d) => d.name === "a-order");
    expect(docs[0].tenant_id).toBe("tenant-a");
  });

  it("does not let other update operators change tenant_id", async () => {
    await attempt(() => colA.updateOne({ name: "a-order" }, { $max: { tenant_id: "zzz" }, $set: { x: 1 } }));
    await attempt(() =>
      colA.updateOne({ name: "a-order" }, [{ $set: { tenant_id: "tenant-b" } }] as unknown as Record<string, unknown>),
    );
    const docs = (await rawDocs("orders")).filter((d) => d.name === "a-order");
    expect(docs[0].tenant_id).toBe("tenant-a");
  });
});

describe("a filter that names another tenant (shared-collection proxy)", () => {
  const CONFLICT = /conflicts with the tenant context/;

  const conflicting: Array<[string, Record<string, unknown>]> = [
    ["a top-level tenant_id", { tenant_id: "tenant-b" }],
    ["tenant_id inside $and", { $and: [{ tenant_id: "tenant-b" }] }],
    ["tenant_id inside $or", { $or: [{ tenant_id: "tenant-b" }, { name: "a-order" }] }],
    ["tenant_id inside $nor", { $nor: [{ tenant_id: "tenant-b" }] }],
    ["tenant_id in nested logical operators", { $and: [{ $or: [{ tenant_id: "tenant-b" }] }] }],
    ["a query operator on tenant_id", { tenant_id: { $in: ["tenant-a", "tenant-b"] } }],
    ["a $ne on tenant_id", { tenant_id: { $ne: "tenant-a" } }],
    ["a dotted tenant_id path", { "tenant_id.x": "y" }],
  ];

  for (const [label, filter] of conflicting) {
    it(`refuses ${label} in find, the same as every other filter method`, async () => {
      expect(() => colA.find(filter)).toThrow(CONFLICT);
      expect(() => colA.findOne(filter)).toThrow(CONFLICT);
      expect(() => colA.countDocuments(filter)).toThrow(CONFLICT);
      expect(() => colA.distinct("name", filter)).toThrow(CONFLICT);
      expect(() => colA.updateOne(filter, { $set: { touched: true } })).toThrow(CONFLICT);
      expect(() => colA.updateMany(filter, { $set: { touched: true } })).toThrow(CONFLICT);
      expect(() => colA.deleteOne(filter)).toThrow(CONFLICT);
      expect(() => colA.deleteMany(filter)).toThrow(CONFLICT);
      expect(() =>
        colA.bulkWrite([{ updateOne: { filter, update: { $set: { touched: true } } } }]),
      ).toThrow(CONFLICT);

      // Nothing ran: both tenants' documents are as they were.
      const docs = await rawDocs("orders");
      expect(docs.map((d) => [d.name, d.tenant_id, d.touched]).sort()).toEqual([
        ["a-order", "tenant-a", undefined],
        ["b-order", "tenant-b", undefined],
      ]);
    });
  }

  it("refuses another tenant's id set later through the find cursor's filter()", () => {
    const cursor = colA.find({}) as unknown as { filter(f: Record<string, unknown>): unknown };
    expect(() => cursor.filter({ $and: [{ tenant_id: "tenant-b" }] })).toThrow(CONFLICT);
  });

  it("matches only the current tenant's documents with $expr, $where and $elemMatch filters", async () => {
    await colA.updateOne({ name: "a-order" }, { $set: { items: [{ tenant_id: "tenant-b" }] } });
    await colB.updateOne({ name: "b-order" }, { $set: { items: [{ tenant_id: "tenant-b" }] } });
    const filters: Record<string, unknown>[] = [
      { $expr: { $or: [{ $eq: ["$tenant_id", "tenant-b"] }, true] } },
      { $where: "this.tenant_id === 'tenant-b' || true" },
      { items: { $elemMatch: { tenant_id: "tenant-b" } } },
      { $or: [{ $expr: { $eq: ["$tenant_id", "tenant-b"] } }, { name: "a-order" }] },
    ];
    for (const filter of filters) {
      const docs = (await colA.find(filter).toArray()) as Array<{ name: string }>;
      expect(docs.map((d) => d.name)).toEqual(["a-order"]);
      // countDocuments runs as an aggregate $match, where the server does not allow $where.
      if (!("$where" in filter)) expect(await colA.countDocuments(filter)).toBe(1);
      await colA.updateMany(filter, { $set: { touched: true } });
    }
    expect(await colA.countDocuments({ $expr: { $eq: ["$tenant_id", "tenant-b"] } })).toBe(0);

    const docs = await rawDocs("orders");
    expect(docs.map((d) => [d.name, d.tenant_id, d.touched]).sort()).toEqual([
      ["a-order", "tenant-a", true],
      ["b-order", "tenant-b", undefined],
    ]);
  });

  it("accepts the context's own tenant_id, as a value, an $eq, or inside $and", async () => {
    for (const filter of [
      { tenant_id: "tenant-a" },
      { tenant_id: { $eq: "tenant-a" } },
      { $and: [{ tenant_id: "tenant-a" }, { name: "a-order" }] },
    ]) {
      const docs = (await colA.find(filter).toArray()) as Array<{ name: string }>;
      expect(docs.map((d) => d.name)).toEqual(["a-order"]);
      expect(await colA.countDocuments(filter)).toBe(1);
    }
  });
});
