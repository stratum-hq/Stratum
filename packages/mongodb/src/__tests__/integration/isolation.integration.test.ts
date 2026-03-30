import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { getTestClient, getTestDbName, cleanupTestClient } from "./setup.js";
import { MongoSharedAdapter } from "../../adapters/shared.js";
import { MongoCollectionAdapter } from "../../adapters/collection.js";
import { MongoDatabaseAdapter } from "../../adapters/database.js";
import type { MongoClient } from "mongodb";
import type { MongoClientLike } from "../../types.js";

let client: MongoClient;

/** Wraps a MongoClient so close() is a no-op. Needed because tests share one
 *  connection but MongoDatabaseAdapter.purgeTenantData calls closeClient(). */
function unclosableClient(c: MongoClient): MongoClientLike {
  return {
    db: (name?: string) => c.db(name),
    close: async () => {},
  } as MongoClientLike;
}

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
    const adapter = new MongoSharedAdapter({
      client: client as unknown as MongoClientLike,
      databaseName: dbName,
    });
    const colB = adapter.scopedCollection("tenant-b", collectionName);
    await colB.insertOne({ data: "secret" });

    const colA = adapter.scopedCollection("tenant-a", collectionName);
    const results = await colA.find({}).toArray();
    expect(results).toHaveLength(0);
  });

  it("purge removes only target tenant data", async () => {
    const adapter = new MongoSharedAdapter({
      client: client as unknown as MongoClientLike,
      databaseName: dbName,
    });
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
    const adapter = new MongoCollectionAdapter({
      client: client as unknown as MongoClientLike,
      databaseName: dbName,
    });
    const colB = adapter.scopedCollection("tenantb", "users");
    await colB.insertOne({ data: "secret" });

    const colA = adapter.scopedCollection("tenanta", "users");
    const results = await colA.find({}).toArray();
    expect(results).toHaveLength(0);
  });

  it("purge drops only target tenant collections", async () => {
    const adapter = new MongoCollectionAdapter({
      client: client as unknown as MongoClientLike,
      databaseName: dbName,
    });
    const colA = adapter.scopedCollection("tenanta", "users");
    const colB = adapter.scopedCollection("tenantb", "users");
    await colA.insertOne({ data: "a-data" });
    await colB.insertOne({ data: "b-data" });

    await adapter.purgeTenantData("tenanta");

    const remainingB = await colB.find({}).toArray();
    expect(remainingB).toHaveLength(1);
    const remainingA = await colA.find({}).toArray();
    expect(remainingA).toHaveLength(0);
  });
});

describe("Database-per-tenant isolation", () => {
  const tenantADb = "stratum_tenant_tenanta";
  const tenantBDb = "stratum_tenant_tenantb";
  const MONGODB_URL = process.env.MONGODB_URL || "mongodb://localhost:27017";

  afterEach(async () => {
    await client.db(tenantADb).dropDatabase().catch(() => {});
    await client.db(tenantBDb).dropDatabase().catch(() => {});
  });

  it("tenantA database is separate from tenantB database", async () => {
    const adapter = new MongoDatabaseAdapter({
      createClient: async () => unclosableClient(client),
      baseUri: `${MONGODB_URL}/stratum_tenant_placeholder`,
    });
    const dbB = await adapter.getDatabase("tenantb");
    await dbB.collection("docs").insertOne({ data: "secret" });

    const dbA = await adapter.getDatabase("tenanta");
    const results = await dbA.collection("docs").find({}).toArray();
    expect(results).toHaveLength(0);
  });

  it("purge drops only target tenant database", async () => {
    const adapter = new MongoDatabaseAdapter({
      createClient: async () => unclosableClient(client),
      baseUri: `${MONGODB_URL}/stratum_tenant_placeholder`,
    });
    const dbA = await adapter.getDatabase("tenanta");
    const dbB = await adapter.getDatabase("tenantb");
    await dbA.collection("docs").insertOne({ data: "a-data" });
    await dbB.collection("docs").insertOne({ data: "b-data" });

    await adapter.purgeTenantData("tenanta");

    const remainingB = await dbB.collection("docs").find({}).toArray();
    expect(remainingB).toHaveLength(1);
  });
});
