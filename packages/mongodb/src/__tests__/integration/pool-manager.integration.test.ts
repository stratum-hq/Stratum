import { describe, it, expect, afterAll, afterEach } from "vitest";
import { MongoClient } from "mongodb";
import { getTestClient, getTestDbName, cleanupTestClient } from "./setup.js";
import { MongoPoolManager } from "../../pool-manager.js";
import type { MongoClientLike } from "../../types.js";

const MONGODB_URL = process.env.MONGODB_URL || "mongodb://localhost:27017";
// Slugs derive from the test database name, so parallel runs do not share tenant databases.
const slugA = `${getTestDbName()}_poola`;
const slugB = `${getTestDbName()}_poolb`;

const created: MongoClient[] = [];
const closed = new Set<MongoClient>();

async function createClient(uri: string): Promise<MongoClientLike> {
  const client = new MongoClient(uri);
  created.push(client);
  const close = client.close.bind(client);
  client.close = async (force?: boolean) => {
    closed.add(client);
    return close(force);
  };
  await client.connect();
  return client as unknown as MongoClientLike;
}

function makeManager(maxClients: number): MongoPoolManager {
  return new MongoPoolManager({
    createClient,
    baseUri: `${MONGODB_URL}/stratum_tenant_placeholder`,
    maxClients,
  });
}

afterEach(async () => {
  await Promise.all(created.map((c) => c.close()));
  created.length = 0;
  closed.clear();
});

afterAll(async () => {
  const admin = await getTestClient();
  await admin.db(`stratum_tenant_${slugA}`).dropDatabase();
  await admin.db(`stratum_tenant_${slugB}`).dropDatabase();
  await cleanupTestClient();
});

describe("MongoPoolManager against a real MongoDB server", () => {
  it("creates one client when five first requests for a tenant run at the same time", async () => {
    const manager = makeManager(5);

    const results = await Promise.all(Array.from({ length: 5 }, () => manager.getClient(slugA)));

    expect(created).toHaveLength(1);
    expect(new Set(results).size).toBe(1);
    await manager.closeAll();
  });

  it("keeps a held client open when another tenant needs the only slot", async () => {
    const manager = makeManager(1);
    const held = await manager.getClient(slugA);

    await manager.getClient(slugB);

    expect(closed.has(created[0])).toBe(false);
    const docs = held.db(`stratum_tenant_${slugA}`).collection("docs");
    await docs.insertOne({ note: "written after the second tenant connected" });
    expect(await docs.countDocuments({})).toBe(1);
    await manager.closeAll();
  });
});
