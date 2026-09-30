import { describe, it, expect, afterAll, afterEach } from "vitest";
import { getTestClient, getTestDbName, cleanupTestClient } from "./setup.js";
import { MongoCollectionAdapter } from "../../adapters/collection.js";
import type { MongoClientLike } from "../../types.js";

const dbName = `${getTestDbName()}_collection_purge`;

afterEach(async () => {
  const client = await getTestClient();
  await client.db(dbName).dropDatabase();
});

afterAll(async () => {
  await cleanupTestClient();
});

describe("collection-per-tenant purge", () => {
  it("purging one tenant leaves a tenant whose slug ends with the same text untouched", async () => {
    const client = await getTestClient();
    const adapter = new MongoCollectionAdapter({
      client: client as unknown as MongoClientLike,
      databaseName: dbName,
      baseCollections: ["users"],
    });

    // Tenant "acme" and tenant "corp_acme" each have a users collection.
    await adapter.scopedCollection("acme", "users").insertOne({ data: "acme" });
    await adapter.scopedCollection("corp_acme", "users").insertOne({ data: "corp_acme" });

    await adapter.purgeTenantData("acme");

    expect(await adapter.scopedCollection("acme", "users").find({}).toArray()).toHaveLength(0);
    expect(await adapter.scopedCollection("corp_acme", "users").find({}).toArray()).toHaveLength(1);
  });
});
