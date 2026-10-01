import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import mongoose, { Schema, type Model } from "mongoose";
import { runWithTenantContext } from "@stratum-hq/sdk";
import type { ResolvedTenantContext } from "@stratum-hq/core";
import { stratumPlugin } from "../../mongoose-plugin.js";
import { getTestDbName } from "./setup.js";

const MONGODB_URL = process.env.MONGODB_URL || "mongodb://localhost:27017";
const dbName = `${getTestDbName()}_mongoose`;

interface Order {
  name: string;
  note?: string;
  tenant_id: string;
}

let conn: mongoose.Connection;
let OrderModel: Model<Order>;

function as<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  const ctx = { tenant_id: tenantId } as ResolvedTenantContext;
  return runWithTenantContext(ctx, fn);
}

/** Runs an operation that may be rejected; rejection is an acceptable outcome. */
async function attempt(fn: () => unknown): Promise<void> {
  try {
    await fn();
  } catch {
    // rejected
  }
}

async function rawOrders(): Promise<Array<Record<string, unknown>>> {
  return conn.db!.collection("orders").find({}).toArray() as Promise<Array<Record<string, unknown>>>;
}

let bId: unknown;

beforeAll(async () => {
  conn = await mongoose.createConnection(`${MONGODB_URL}/${dbName}`).asPromise();
  const schema = new Schema<Order>({ name: String, note: String });
  schema.plugin(stratumPlugin as unknown as (s: Schema) => void);
  OrderModel = conn.model<Order>("Order", schema, "orders");
  await conn.db!.collection("customers").insertOne({ name: "b-customer", tenant_id: "tenant-b" });
});

beforeEach(async () => {
  await conn.db!.collection("orders").deleteMany({});
  // Seeded through the driver: these tests cover query middleware, not save.
  const b = await conn.db!.collection("orders").insertOne({ name: "b-order", tenant_id: "tenant-b" });
  bId = b.insertedId;
  await conn.db!.collection("orders").insertOne({ name: "a-order", tenant_id: "tenant-a" });
});

afterAll(async () => {
  await conn.dropDatabase();
  await conn.close();
});

describe(`stratumPlugin query scoping (Mongoose ${mongoose.version})`, () => {
  it("findOneAndUpdate / findByIdAndUpdate cannot reach another tenant's document", async () => {
    const res = await as("tenant-a", () =>
      OrderModel.findByIdAndUpdate(bId, { name: "changed" }, { new: true }).lean().exec(),
    );
    expect(res).toBeNull();
    const b = (await rawOrders()).find((d) => d.tenant_id === "tenant-b");
    expect(b?.name).toBe("b-order");
  });

  it("findOneAndDelete / findByIdAndDelete cannot remove another tenant's document", async () => {
    const res = await as("tenant-a", () => OrderModel.findByIdAndDelete(bId).lean().exec());
    expect(res).toBeNull();
    expect((await rawOrders()).some((d) => d.tenant_id === "tenant-b")).toBe(true);
  });

  it("findOneAndReplace cannot replace another tenant's document", async () => {
    const res = await as("tenant-a", () =>
      OrderModel.findOneAndReplace({ _id: bId }, { name: "replaced" }).lean().exec(),
    );
    expect(res).toBeNull();
    const b = (await rawOrders()).find((d) => d.tenant_id === "tenant-b");
    expect(b?.name).toBe("b-order");
  });

  it("replaceOne cannot replace another tenant's document", async () => {
    const res = await as("tenant-a", () => OrderModel.replaceOne({ _id: bId }, { name: "replaced" }).exec());
    expect(res.matchedCount).toBe(0);
  });

  it("distinct returns only the current tenant's values", async () => {
    const names = await as("tenant-a", () => OrderModel.distinct("name").exec());
    expect(names).toEqual(["a-order"]);
  });

  it("insertMany assigns the current tenant to every document", async () => {
    await as("tenant-a", () => OrderModel.insertMany([{ name: "many", tenant_id: "tenant-b" }]));
    const docs = (await rawOrders()).filter((d) => d.name === "many");
    expect(docs).toHaveLength(1);
    expect(docs[0].tenant_id).toBe("tenant-a");
  });

  it("bulkWrite is scoped to the current tenant", async () => {
    await attempt(() => as("tenant-a", () =>
      OrderModel.bulkWrite([
        { updateOne: { filter: { _id: bId }, update: { $set: { name: "bulk" } } } },
        { insertOne: { document: { name: "bulk-insert", tenant_id: "tenant-b" } } },
      ] as never),
    ));
    const docs = await rawOrders();
    expect(docs.find((d) => d.tenant_id === "tenant-b" && d.name === "bulk")).toBeUndefined();
    expect(docs.find((d) => d.name === "bulk-insert" && d.tenant_id === "tenant-b")).toBeUndefined();
  });

  it("aggregate rejects stages that read other collections, at any depth", async () => {
    await expect(
      as("tenant-a", () =>
        OrderModel.aggregate([{ $lookup: { from: "customers", pipeline: [], as: "c" } }]).exec(),
      ),
    ).rejects.toThrow(/blocked/);
    await expect(
      as("tenant-a", () =>
        OrderModel.aggregate([
          { $facet: { x: [{ $unionWith: { coll: "customers" } }] } },
        ]).exec(),
      ),
    ).rejects.toThrow(/blocked/);
  });

  it("aggregate with safe stages stays tenant-scoped", async () => {
    const docs = await as("tenant-a", () =>
      OrderModel.aggregate<{ name: string }>([{ $project: { _id: 0, name: 1 } }]).exec(),
    );
    expect(docs).toEqual([{ name: "a-order" }]);
  });

  it("an update mixing a top-level tenant_id with operators cannot reassign the document", async () => {
    await as("tenant-a", () =>
      OrderModel.updateOne({ name: "a-order" }, { tenant_id: "tenant-b", $set: { note: "x" } } as never).exec(),
    );
    const a = (await rawOrders()).find((d) => d.name === "a-order");
    expect(a?.tenant_id).toBe("tenant-a");
  });

  it("an upsert with $setOnInsert cannot create a document in another tenant", async () => {
    await as("tenant-a", () =>
      OrderModel.updateOne(
        { name: "upserted" },
        { $setOnInsert: { tenant_id: "tenant-b" } },
        { upsert: true },
      ).exec(),
    );
    const docs = (await rawOrders()).filter((d) => d.name === "upserted");
    expect(docs).toHaveLength(1);
    expect(docs[0].tenant_id).toBe("tenant-a");
  });

  it("estimatedDocumentCount is rejected because it cannot be scoped", async () => {
    await expect(as("tenant-a", () => OrderModel.estimatedDocumentCount().exec())).rejects.toThrow(
      /estimatedDocumentCount/,
    );
  });

  it("query and aggregate cursors are scoped", async () => {
    await as("tenant-a", async () => {
      const found: string[] = [];
      for await (const d of OrderModel.find({}).lean().cursor()) found.push((d as Order).name);
      expect(found).toEqual(["a-order"]);
      const aggregated: string[] = [];
      for await (const d of OrderModel.aggregate<Order>([]).cursor()) aggregated.push(d.name);
      expect(aggregated).toEqual(["a-order"]);
    });
  });

  it("existing hooks keep working: find, countDocuments, updateOne, deleteOne", async () => {
    await as("tenant-a", async () => {
      expect((await OrderModel.find({}).lean().exec()).map((d) => d.name)).toEqual(["a-order"]);
      expect(await OrderModel.countDocuments({}).exec()).toBe(1);
      expect((await OrderModel.updateOne({ _id: bId }, { $set: { name: "x" } }).exec()).matchedCount).toBe(0);
      expect((await OrderModel.deleteOne({ _id: bId }).exec()).deletedCount).toBe(0);
    });
  });
});

describe(`stratumPlugin document writes (Mongoose ${mongoose.version})`, () => {
  it("create() stores the document in the current tenant", async () => {
    await as("tenant-a", () => OrderModel.create({ name: "created" }));
    const docs = (await rawOrders()).filter((d) => d.name === "created");
    expect(docs).toHaveLength(1);
    expect(docs[0].tenant_id).toBe("tenant-a");
  });

  it("save() on a new document stores it in the current tenant, not the supplied one", async () => {
    await as("tenant-a", () => new OrderModel({ name: "saved", tenant_id: "tenant-b" }).save());
    const docs = (await rawOrders()).filter((d) => d.name === "saved");
    expect(docs).toHaveLength(1);
    expect(docs[0].tenant_id).toBe("tenant-a");
  });

  it("save() on an existing document updates it and keeps its tenant", async () => {
    await as("tenant-a", async () => {
      const doc = await OrderModel.findOne({ name: "a-order" }).exec();
      expect(doc).not.toBeNull();
      doc!.note = "edited";
      await doc!.save();
    });
    const a = (await rawOrders()).find((d) => d.name === "a-order");
    expect(a?.note).toBe("edited");
    expect(a?.tenant_id).toBe("tenant-a");
  });

  it("insertMany() resolves and stores every document in the current tenant", async () => {
    const inserted = await as("tenant-a", () => OrderModel.insertMany([{ name: "m1" }, { name: "m2" }]));
    expect(inserted).toHaveLength(2);
    const docs = (await rawOrders()).filter((d) => d.name === "m1" || d.name === "m2");
    expect(docs.map((d) => d.tenant_id)).toEqual(["tenant-a", "tenant-a"]);
  });

  it("bulkWrite() runs its operations inside the current tenant only", async () => {
    const res = await as("tenant-a", () =>
      OrderModel.bulkWrite([
        { updateMany: { filter: {}, update: { $set: { note: "bulk" } } } },
        { insertOne: { document: { name: "bulk-insert", tenant_id: "tenant-b" } } },
      ] as never),
    );
    expect(res.matchedCount).toBe(1);
    expect(res.insertedCount).toBe(1);
    const docs = await rawOrders();
    expect(docs.find((d) => d.name === "a-order")?.note).toBe("bulk");
    expect(docs.find((d) => d.name === "b-order")?.note).toBeUndefined();
    expect(docs.find((d) => d.name === "bulk-insert")?.tenant_id).toBe("tenant-a");
  });
});
