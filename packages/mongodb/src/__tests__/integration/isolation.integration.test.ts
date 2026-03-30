import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { getTestClient, getTestDbName, cleanupTestClient } from "./setup.js";
import { MongoSharedAdapter } from "../../adapters/shared.js";
import { MongoCollectionAdapter } from "../../adapters/collection.js";
import { MongoDatabaseAdapter } from "../../adapters/database.js";
import type { MongoClient } from "mongodb";

let client: MongoClient;

beforeEach(async () => {
  client = await getTestClient();
});

afterAll(async () => {
  await cleanupTestClient();
});

describe("Shared-collection isolation", () => {
  const dbName = `${getTestDbName()}_shared`;
  const collectionName = "test_docs";

  afterEach(async () => {
    await client.db(dbName).dropDatabase();
  });

  it("tenantA cannot read tenantB documents", async () => {
    const adapter = new MongoSharedAdapter(client, { databaseName: dbName });
    const colB = adapter.scopedCollection("tenant-b", collectionName);
    await colB.insertOne({ data: "secret" });

    const colA = adapter.scopedCollection("tenant-a", collectionName);
    const results = await colA.find({}).toArray();
    expect(results).toHaveLength(0);
  });

  it("purge removes only target tenant data", async () => {
    const adapter = new MongoSharedAdapter(client, { databaseName: dbName });
    const colA = adapter.scopedCollection("tenant-a", collectionName);
    const colB = adapter.scopedCollection("tenant-b", collectionName);
    await colA.insertOne({ data: "a-data" });
    await colB.insertOne({ data: "b-data" });

    await adapter.purgeTenantData("tenant-a");

    const remainingB = await colB.find({}).toArray();
    expect(remainingB).toHaveLength(1);
    const remainingA = await colA.find({}).toArray();
    expect(remainingA).toHaveLength(0);
  });
});

describe("Collection-per-tenant isolation", () => {
  const dbName = `${getTestDbName()}_collection`;

  afterEach(async () => {
    await client.db(dbName).dropDatabase();
  });

  it("tenantA collection is separate from tenantB collection", async () => {
    const adapter = new MongoCollectionAdapter(client, { databaseName: dbName });
    const colB = adapter.scopedCollection("tenantb", "users");
    await colB.insertOne({ data: "secret" });

    const colA = adapter.scopedCollection("tenanta", "users");
    const results = await colA.find({}).toArray();
    expect(results).toHaveLength(0);
  });

  it("purge drops only target tenant collections", async () => {
    const adapter = new MongoCollectionAdapter(client, { databaseName: dbName });
    const colA = adapter.scopedCollection("tenanta", "users");
    const colB = adapter.scopedCollection("tenantb", "users");
    await colA.insertOne({ data: "a-data" });
    await colB.insertOne({ data: "b-data" });

    await adapter.purgeTenantData("tenanta");

    const remainingB = await colB.find({}).toArray();
    expect(remainingB).toHaveLength(1);
    // tenantA's collection should be gone
    const remainingA = await colA.find({}).toArray();
    expect(remainingA).toHaveLength(0);
  });
});

describe("Database-per-tenant isolation", () => {
  const tenantADb = "stratum_tenant_tenanta";
  const tenantBDb = "stratum_tenant_tenantb";

  afterEach(async () => {
    await client.db(tenantADb).dropDatabase().catch(() => {});
    await client.db(tenantBDb).dropDatabase().catch(() => {});
  });

  it("tenantA database is separate from tenantB database", async () => {
    const adapter = new MongoDatabaseAdapter(client, {});
    const dbB = adapter.getDatabase("tenantb");
    await dbB.collection("docs").insertOne({ data: "secret" });

    const dbA = adapter.getDatabase("tenanta");
    const results = await dbA.collection("docs").find({}).toArray();
    expect(results).toHaveLength(0);
  });

  it("purge drops only target tenant database", async () => {
    const adapter = new MongoDatabaseAdapter(client, {});
    const dbA = adapter.getDatabase("tenanta");
    const dbB = adapter.getDatabase("tenantb");
    await dbA.collection("docs").insertOne({ data: "a-data" });
    await dbB.collection("docs").insertOne({ data: "b-data" });

    await adapter.purgeTenantData("tenanta");

    const remainingB = await dbB.collection("docs").find({}).toArray();
    expect(remainingB).toHaveLength(1);
  });
});
