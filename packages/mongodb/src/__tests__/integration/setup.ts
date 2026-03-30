// Integration test setup — connects to real MongoDB
// Requires MONGODB_URL environment variable (set by CI or local docker)
import { MongoClient } from "mongodb";

const MONGODB_URL = process.env.MONGODB_URL || "mongodb://localhost:27017";
const TEST_DB = process.env.MONGODB_TEST_DB || "stratum_test";

let client: MongoClient;

export async function getTestClient(): Promise<MongoClient> {
  if (!client) {
    client = new MongoClient(MONGODB_URL);
    await client.connect();
  }
  return client;
}

export function getTestDbName(): string {
  return TEST_DB;
}

export async function cleanupTestClient(): Promise<void> {
  if (client) {
    await client.close();
  }
}
