import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { once } from "node:events";
import mongoose, { Schema, type Model } from "mongoose";
import type { MongoClient } from "mongodb";
import { runWithTenantContext } from "@stratum-hq/sdk";
import type { ResolvedTenantContext } from "@stratum-hq/core";
import { getTestClient, getTestDbName, cleanupTestClient } from "./setup.js";
import { MongoSharedAdapter } from "../../adapters/shared.js";
import { MongoCollectionAdapter } from "../../adapters/collection.js";
import { stratumPlugin } from "../../mongoose-plugin.js";
import type { MongoClientLike, CollectionLike } from "../../types.js";

const MONGODB_URL = process.env.MONGODB_URL || "mongodb://localhost:27017";
const dbName = `${getTestDbName()}_scope_boundaries`;

let client: MongoClient;

function as<T>(tenantId: string, fn: () => T): T {
  return runWithTenantContext({ tenant_id: tenantId } as ResolvedTenantContext, fn);
}

beforeAll(async () => {
  client = await getTestClient();
});

afterAll(async () => {
  await client.db(dbName).dropDatabase();
  await cleanupTestClient();
});

describe("aggregation cursor pipeline (shared-collection proxy)", () => {
  let colA: CollectionLike;

  beforeEach(async () => {
    await client.db(dbName).dropDatabase();
    const adapter = new MongoSharedAdapter({
      client: client as unknown as MongoClientLike,
      databaseName: dbName,
    });
    colA = adapter.scopedCollection("tenant-a", "orders");
    await adapter.scopedCollection("tenant-b", "orders").insertOne({ name: "b-order" });
    await adapter.scopedCollection("tenant-b", "customers").insertOne({ name: "b-customer" });
    await colA.insertOne({ name: "a-order" });
  });

  async function names(run: () => Promise<unknown[]>): Promise<string[] | "rejected"> {
    try {
      const docs = (await run()) as Array<Record<string, unknown>>;
      return docs.flatMap((d) => [
        String(d.name),
        ...((d.all as Array<{ name: string }> | undefined) ?? []).map((x) => x.name),
      ]);
    } catch {
      return "rejected";
    }
  }

  it("keeps the tenant $match when the cursor's pipeline array is edited in place", async () => {
    const result = await names(async () => {
      const cursor = colA.aggregate([]) as unknown as { pipeline: unknown[]; toArray(): Promise<unknown[]> };
      cursor.pipeline.splice(0, cursor.pipeline.length);
      return cursor.toArray();
    });
    expect(result === "rejected" || !result.includes("b-order")).toBe(true);
  });

  it("does not run a blocked stage pushed onto the cursor's pipeline array", async () => {
    const result = await names(async () => {
      const cursor = colA.aggregate([]) as unknown as { pipeline: unknown[]; toArray(): Promise<unknown[]> };
      cursor.pipeline.push({ $lookup: { from: "customers", pipeline: [], as: "all" } });
      return cursor.toArray();
    });
    expect(result === "rejected" || !result.includes("b-customer")).toBe(true);
  });

  it("does not run a blocked stage nested into an already validated stage", async () => {
    let raw: string;
    try {
      const cursor = colA.aggregate([{ $facet: { x: [] } }]) as unknown as {
        pipeline: Array<Record<string, { x: unknown[] }>>;
        toArray(): Promise<unknown[]>;
      };
      cursor.pipeline[1].$facet.x.push({ $lookup: { from: "customers", pipeline: [], as: "all" } });
      raw = JSON.stringify(await cursor.toArray());
    } catch {
      raw = "rejected";
    }
    expect(raw.includes("b-customer")).toBe(false);
  });

  it("keeps the tenant filter when the find cursor's filter object is edited in place", async () => {
    let raw: string;
    try {
      const cursor = colA.find({}) as unknown as {
        cursorFilter: Record<string, unknown>;
        toArray(): Promise<unknown[]>;
      };
      delete cursor.cursorFilter.tenant_id;
      raw = JSON.stringify(await cursor.toArray());
    } catch {
      raw = "rejected";
    }
    expect(raw.includes("b-order")).toBe(false);
  });

  it("still supports builder methods with safe stages", async () => {
    const cursor = colA.aggregate([]) as unknown as {
      project(p: unknown): { toArray(): Promise<Array<{ name: string }>> };
    };
    const docs = await cursor.project({ _id: 0, name: 1 }).toArray();
    expect(docs).toEqual([{ name: "a-order" }]);
  });
});

interface Order {
  name: string;
  tenant_id: string;
}

describe("stratumPlugin watch() and aggregate (real Mongoose)", () => {
  let conn: mongoose.Connection;
  let OrderModel: Model<Order>;

  beforeAll(async () => {
    conn = await mongoose.createConnection(`${MONGODB_URL}/${dbName}`).asPromise();
    const schema = new Schema<Order>({ name: String });
    schema.plugin(stratumPlugin as unknown as (s: Schema) => void);
    OrderModel = conn.model<Order>("Order", schema, "orders");
  });

  afterAll(async () => {
    await conn.close();
  });

  beforeEach(async () => {
    await conn.db!.collection("orders").deleteMany({});
    await conn.db!.collection("customers").deleteMany({});
    await conn.db!.collection("orders").insertMany([
      { name: "a-order", tenant_id: "tenant-a" },
      { name: "b-order", tenant_id: "tenant-b" },
    ]);
    await conn.db!.collection("customers").insertOne({ name: "b-customer", tenant_id: "tenant-b" });
  });

  // The test server is a standalone mongod, which has no change streams. The
  // test therefore captures the pipeline that real Mongoose hands to the
  // driver's Collection.watch() and checks the tenant filter is its first stage.
  async function capturedWatch(
    tenantId: string,
    pipeline?: unknown[],
  ): Promise<{ pipeline: unknown[]; options: Record<string, unknown> }> {
    const watch = vi.spyOn(OrderModel.collection, "watch");
    try {
      const stream = as(tenantId, () => OrderModel.watch(pipeline as never));
      stream.on("error", () => {});
      await vi.waitFor(() => expect(watch).toHaveBeenCalled());
      await stream.close();
      const [passedPipeline, options] = watch.mock.calls[0] as unknown as [unknown[], Record<string, unknown>];
      return { pipeline: passedPipeline, options };
    } finally {
      watch.mockRestore();
    }
  }

  it("watch() streams only the current tenant's documents", async () => {
    const { pipeline, options } = await capturedWatch("tenant-a");
    expect(pipeline[0]).toEqual({ $match: { "fullDocument.tenant_id": "tenant-a" } });
    expect(options.fullDocument).toBe("updateLookup");
  });

  it("watch() keeps the tenant filter ahead of the caller's stages", async () => {
    const { pipeline } = await capturedWatch("tenant-a", [{ $match: { operationType: "insert" } }]);
    expect(pipeline).toEqual([
      { $match: { "fullDocument.tenant_id": "tenant-a" } },
      { $match: { operationType: "insert" } },
    ]);
  });

  it("watch() refuses to start without a tenant context", () => {
    expect(() => OrderModel.watch()).toThrow();
  });

  it("aggregate re-checks a pipeline edited after it was built", async () => {
    const agg = OrderModel.aggregate([]);
    agg.pipeline().push({ $lookup: { from: "customers", pipeline: [], as: "all" } });
    await expect(as("tenant-a", () => agg.exec())).rejects.toThrow(/blocked/);
  });

  it("aggregate on a discriminator model can run more than once", async () => {
    const Special = OrderModel.discriminator("P2Special", new Schema({ extra: String }));
    await conn.db!.collection("orders").insertMany([
      { name: "a-special", __t: "P2Special", tenant_id: "tenant-a" },
      { name: "b-special", __t: "P2Special", tenant_id: "tenant-b" },
    ]);
    const agg = Special.aggregate([{ $project: { _id: 0, name: 1 } }]);
    const first = await as("tenant-a", () => agg.exec());
    const second = await as("tenant-a", () => agg.exec());
    expect(first).toEqual([{ name: "a-special" }]);
    expect(second).toEqual([{ name: "a-special" }]);
  });

  it("stratumPlugin refuses a schema that already defines a watch() static", () => {
    const schema = new Schema({ name: String });
    schema.static("watch", function () {
      return null;
    });
    expect(() => schema.plugin(stratumPlugin as unknown as (s: Schema) => void)).toThrow(/watch/);
  });

  it("aggregate cursor does not run a stage pushed onto the driver cursor's pipeline", async () => {
    let seen: string[] | "rejected";
    try {
      const cursor = as("tenant-a", () => OrderModel.aggregate([]).cursor());
      const [driverCursor] = (await once(cursor, "cursor")) as [{ pipeline: unknown[] }];
      driverCursor.pipeline.push({ $lookup: { from: "customers", pipeline: [], as: "all" } });
      const docs: Array<{ all?: Array<{ name: string }> }> = [];
      for await (const doc of cursor) docs.push(doc as { all?: Array<{ name: string }> });
      seen = docs.flatMap((d) => (d.all ?? []).map((x) => x.name));
    } catch {
      seen = "rejected";
    }
    expect(seen === "rejected" || !seen.includes("b-customer")).toBe(true);
  });
});

describe("MongoCollectionAdapter collection names", () => {
  beforeEach(async () => {
    await client.db(dbName).dropDatabase();
  });

  it("never gives two tenants the same collection when base names and slugs overlap", async () => {
    const adapter = new MongoCollectionAdapter({
      client: client as unknown as MongoClientLike,
      databaseName: dbName,
    });

    let corpAcmeOrders: CollectionLike;
    let acmeOrdersCorp: CollectionLike;
    try {
      corpAcmeOrders = adapter.scopedCollection("corp_acme", "orders");
      acmeOrdersCorp = adapter.scopedCollection("acme", "orders_corp");
    } catch {
      // Refusing to derive an ambiguous name is a safe outcome.
      return;
    }

    await corpAcmeOrders.insertOne({ secret: "corp_acme secret" });
    expect(await acmeOrdersCorp.find({}).toArray()).toEqual([]);
  });

  it("refuses to derive a collection name without baseCollections", () => {
    const adapter = new MongoCollectionAdapter({
      client: client as unknown as MongoClientLike,
      databaseName: dbName,
    });
    expect(() => adapter.scopedCollection("acme", "orders")).toThrow(/baseCollections/);
  });
});
