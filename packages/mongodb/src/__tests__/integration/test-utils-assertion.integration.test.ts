import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose, { Schema } from "mongoose";
import { assertMongoIsolation } from "@stratum-hq/test-utils";
import type { MongoIsolationCollection } from "@stratum-hq/test-utils";
import { runWithTenantContext } from "@stratum-hq/sdk";
import type { ResolvedTenantContext } from "@stratum-hq/core";
import { getTestClient, getTestDbName, cleanupTestClient } from "./setup.js";
import { MongoSharedAdapter } from "../../adapters/shared.js";
import { MongoCollectionAdapter } from "../../adapters/collection.js";
import { stratumPlugin } from "../../mongoose-plugin.js";
import type { MongoClient } from "mongodb";
import type { MongoClientLike } from "../../types.js";

const MONGODB_URL = process.env.MONGODB_URL || "mongodb://localhost:27017";
const dbName = `${getTestDbName()}_assertion`;
let client: MongoClient;
let conn: mongoose.Connection;

beforeAll(async () => {
  client = await getTestClient();
  conn = await mongoose.createConnection(`${MONGODB_URL}/${dbName}`).asPromise();
});

afterAll(async () => {
  await client.db(dbName).dropDatabase();
  await conn.close();
  await cleanupTestClient();
});

function mongooseAccessor(model: mongoose.Model<Record<string, unknown>>) {
  return (tenantId: string): MongoIsolationCollection => {
    const as = <T>(fn: () => Promise<T>) =>
      runWithTenantContext({ tenant_id: tenantId } as ResolvedTenantContext, fn);
    return {
      insertOne: (doc) => as(() => model.insertMany([doc])),
      findOne: (filter) => as(() => model.findOne(filter).lean().exec()),
      deleteOne: (filter) => as(() => model.deleteOne(filter).exec()),
    };
  };
}

describe("assertMongoIsolation", () => {
  it("passes for the shared-collection adapter", async () => {
    const adapter = new MongoSharedAdapter({ client: client as unknown as MongoClientLike, databaseName: dbName });
    await assertMongoIsolation((t) => adapter.scopedCollection(t, "iso"), "tenant-a", "tenant-b", {
      strategy: "SHARED_COLLECTION",
    });
  });

  it("passes for the collection-per-tenant adapter", async () => {
    const adapter = new MongoCollectionAdapter({ client: client as unknown as MongoClientLike, databaseName: dbName });
    await assertMongoIsolation((t) => adapter.scopedCollection(t, "iso"), "tenanta", "tenantb", {
      strategy: "COLLECTION_PER_TENANT",
    });
  });

  it("passes for a Mongoose model with stratumPlugin", async () => {
    const schema = new Schema<Record<string, unknown>>({}, { strict: false });
    schema.plugin(stratumPlugin as unknown as (s: Schema) => void);
    const model = conn.model<Record<string, unknown>>("Scoped", schema, "iso_mongoose");
    await assertMongoIsolation(mongooseAccessor(model), "tenant-a", "tenant-b");
  });

  it("fails when the data path under test does not isolate tenants", async () => {
    const unscoped = () => client.db(dbName).collection("iso_raw");
    await expect(
      assertMongoIsolation(unscoped, "tenant-a", "tenant-b", { strategy: "SHARED_COLLECTION" }),
    ).rejects.toThrow(/isolation is not enforced/);
  });

  it("fails for a Mongoose model without stratumPlugin", async () => {
    const schema = new Schema<Record<string, unknown>>({}, { strict: false });
    const model = conn.model<Record<string, unknown>>("Unscoped", schema, "iso_mongoose_raw");
    await expect(assertMongoIsolation(mongooseAccessor(model), "tenant-a", "tenant-b")).rejects.toThrow(
      /isolation is not enforced/,
    );
  });

  it("rejects a raw client instead of an accessor", async () => {
    await expect(
      assertMongoIsolation(client as never, "tenant-a", "tenant-b", { strategy: "SHARED_COLLECTION" }),
    ).rejects.toThrow(TypeError);
  });
});
