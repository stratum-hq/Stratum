import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import mongoose, { Schema, type Model } from "mongoose";
import type { Timestamp } from "mongodb";
import { runWithTenantContext } from "@stratum-hq/sdk";
import type { ResolvedTenantContext } from "@stratum-hq/core";
import { stratumPlugin } from "../../mongoose-plugin.js";

// Change streams need a replica set, and the default test server is a
// standalone mongod. These tests run only when MONGODB_RS_URL names a replica set.
const RS_URL = process.env.MONGODB_RS_URL;
const dbName = `${process.env.MONGODB_TEST_DB || "stratum_test"}_watch_deletes`;

if (!RS_URL) {
  console.warn("watch-deletes: MONGODB_RS_URL is not set, so the change stream tests are skipped.");
}

interface Order {
  name: string;
  tenant_id: string;
}

interface ChangeEvent {
  operationType: string;
  documentKey?: { _id: unknown };
  fullDocument?: Order;
  fullDocumentBeforeChange?: Order;
}

interface StreamLike {
  on(event: "change", fn: (change: ChangeEvent) => void): unknown;
  on(event: "error", fn: (err: Error) => void): unknown;
  close(): Promise<unknown>;
}

function as<T>(tenantId: string, fn: () => T): T {
  return runWithTenantContext({ tenant_id: tenantId } as ResolvedTenantContext, fn);
}

/** Collect change events until `done` accepts one. Reject on a stream error or after the timeout. */
function collectUntil(stream: StreamLike, done: (c: ChangeEvent) => boolean, timeoutMs = 10000): Promise<ChangeEvent[]> {
  return new Promise((resolve, reject) => {
    const seen: ChangeEvent[] = [];
    const timer = setTimeout(
      () => reject(new Error(`no matching event after ${timeoutMs} ms; seen: ${JSON.stringify(seen)}`)),
      timeoutMs,
    );
    stream.on("change", (change) => {
      seen.push(change);
      if (done(change)) {
        clearTimeout(timer);
        resolve(seen);
      }
    });
    stream.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function nextError(stream: StreamLike, timeoutMs = 10000): Promise<Error> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no error after ${timeoutMs} ms`)), timeoutMs);
    stream.on("error", (err) => {
      clearTimeout(timer);
      resolve(err);
    });
  });
}

describe.skipIf(!RS_URL)("stratumPlugin watch() with watchDeletes (replica set)", () => {
  let conn: mongoose.Connection;
  let DeletesModel: Model<Order>;
  let PlainModel: Model<Order>;
  let NoPreImagesModel: Model<Order>;
  const streams: StreamLike[] = [];

  function model(name: string, collection: string, watchDeletes: boolean): Model<Order> {
    const schema = new Schema<Order>({ name: String });
    schema.plugin(stratumPlugin as unknown as (s: Schema, o: unknown) => void, watchDeletes ? { watchDeletes } : undefined);
    return conn.model<Order>(name, schema, collection);
  }

  /** The cluster time now, so a stream sees every write made after this call. */
  async function clusterTime(): Promise<Timestamp> {
    const res = await conn.db!.command({ ping: 1 });
    return res.operationTime as Timestamp;
  }

  async function watch(m: Model<Order>, tenantId: string): Promise<StreamLike> {
    const startAtOperationTime = await clusterTime();
    const stream = as(tenantId, () => m.watch([], { startAtOperationTime })) as unknown as StreamLike;
    streams.push(stream);
    return stream;
  }

  beforeAll(async () => {
    conn = await mongoose.createConnection(RS_URL!, { dbName }).asPromise();
    await conn.dropDatabase();
    await conn.createCollection("orders", { changeStreamPreAndPostImages: { enabled: true } });
    await conn.createCollection("plain_orders");
    DeletesModel = model("WdOrder", "orders", true);
    PlainModel = model("WdPlainOrder", "orders", false);
    NoPreImagesModel = model("WdNoPreImages", "plain_orders", true);
  });

  afterAll(async () => {
    await Promise.all(streams.map((s) => s.close().catch(() => {})));
    await conn.dropDatabase();
    await conn.close();
  });

  beforeEach(async () => {
    await conn.db!.collection("orders").deleteMany({});
    await conn.db!.collection("orders").insertMany([
      { name: "a-order", tenant_id: "tenant-a" },
      { name: "a-marker", tenant_id: "tenant-a" },
      { name: "b-order", tenant_id: "tenant-b" },
    ]);
  });

  it("delivers a delete of the current tenant's document", async () => {
    const stream = await watch(DeletesModel, "tenant-a");
    const events = collectUntil(stream, (c) => c.operationType === "delete");
    await conn.db!.collection("orders").deleteOne({ name: "a-order" });

    const [change] = await events;
    expect(change.operationType).toBe("delete");
    expect(change.fullDocumentBeforeChange).toMatchObject({ name: "a-order", tenant_id: "tenant-a" });
  });

  it("does not deliver a delete of another tenant's document", async () => {
    const stream = await watch(DeletesModel, "tenant-a");
    const events = collectUntil(stream, (c) => c.fullDocumentBeforeChange?.name === "a-marker");
    await conn.db!.collection("orders").deleteOne({ name: "b-order" });
    await conn.db!.collection("orders").deleteOne({ name: "a-marker" });

    const seen = await events;
    expect(seen.map((c) => c.fullDocumentBeforeChange?.name)).toEqual(["a-marker"]);
  });

  it("still delivers only the current tenant's update events", async () => {
    const stream = await watch(DeletesModel, "tenant-a");
    const events = collectUntil(stream, (c) => c.fullDocument?.name === "a-order-2");
    await conn.db!.collection("orders").updateOne({ name: "b-order" }, { $set: { name: "b-order-2" } });
    await conn.db!.collection("orders").updateOne({ name: "a-order" }, { $set: { name: "a-order-2" } });

    const seen = await events;
    expect(seen.map((c) => [c.operationType, c.fullDocument?.name])).toEqual([["update", "a-order-2"]]);
  });

  it("does not deliver an update whose pre-image belongs to another tenant", async () => {
    const stream = await watch(DeletesModel, "tenant-a");
    const events = collectUntil(stream, (c) => c.fullDocumentBeforeChange?.name === "a-marker");
    // An unscoped write moves the document to tenant-a. Its pre-image is tenant-b's data.
    await conn.db!.collection("orders").updateOne({ name: "b-order" }, { $set: { tenant_id: "tenant-a" } });
    await conn.db!.collection("orders").deleteOne({ name: "a-marker" });

    const seen = await events;
    expect(seen.map((c) => c.operationType)).toEqual(["delete"]);
  });

  it("does not deliver a delete when the option is off", async () => {
    const stream = await watch(PlainModel, "tenant-a");
    const events = collectUntil(stream, (c) => c.operationType === "insert");
    await conn.db!.collection("orders").deleteOne({ name: "a-order" });
    await conn.db!.collection("orders").insertOne({ name: "a-new", tenant_id: "tenant-a" });

    const seen = await events;
    expect(seen.map((c) => c.operationType)).toEqual(["insert"]);
  });

  it("fails with an error that names changeStreamPreAndPostImages when the collection has no pre-images", async () => {
    const stream = await watch(NoPreImagesModel, "tenant-a");
    const err = await nextError(stream);
    expect(err.message).toMatch(/changeStreamPreAndPostImages/);
    expect(err.message).toMatch(/plain_orders/);
  });
});
