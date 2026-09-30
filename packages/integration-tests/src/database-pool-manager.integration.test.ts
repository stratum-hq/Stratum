import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import type pg from "pg";
import { DatabasePoolManager, createDatabase, dropDatabase } from "@stratum-hq/db-adapters";
import { getPool, closePool } from "./helpers/db.js";

/**
 * DatabasePoolManager opens one pg.Pool per tenant database. These checks run
 * against a real server, because the defects they guard against show up as
 * extra connections and as "Cannot use a pool after calling end on the pool".
 */

const run = Date.now().toString(36);
const slugA = `pm${run}a`;
const slugB = `pm${run}b`;

const url = new URL(
  process.env.DATABASE_URL || "postgresql://stratum_test:stratum_test@localhost:5433/stratum_test",
);
// pg gives connectionString priority over `database`, so the manager gets the parts.
const baseConnectionConfig: pg.PoolConfig = {
  host: url.hostname,
  port: Number(url.port || 5432),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  max: 2,
};

let manager: DatabasePoolManager | undefined;

beforeAll(async () => {
  const admin = await getPool().connect();
  try {
    await createDatabase(admin, slugA);
    await createDatabase(admin, slugB);
  } finally {
    admin.release();
  }
});

afterEach(async () => {
  await manager?.closeAll();
  manager = undefined;
});

afterAll(async () => {
  const admin = await getPool().connect();
  try {
    await dropDatabase(admin, slugA);
    await dropDatabase(admin, slugB);
  } finally {
    admin.release();
  }
  await closePool();
});

describe("DatabasePoolManager against a real PostgreSQL server", () => {
  it("creates one pool when five first requests for a tenant run at the same time", async () => {
    manager = new DatabasePoolManager({ baseConnectionConfig, maxPools: 1 });
    // A full manager makes each first request evict before it creates a pool.
    await manager.getPool(slugB);
    manager.releasePool(slugB);

    const pools = await Promise.all(Array.from({ length: 5 }, () => manager!.getPool(slugA)));

    expect(new Set(pools).size).toBe(1);
    expect(manager.getStats().poolCount).toBe(1);
    const r = await pools[0].query<{ db: string }>("SELECT current_database() AS db");
    expect(r.rows[0].db).toBe(`stratum_tenant_${slugA}`);
  });

  it("keeps a held pool usable when another tenant needs the only slot", async () => {
    manager = new DatabasePoolManager({ baseConnectionConfig, maxPools: 1 });
    const held = await manager.getPool(slugA);
    const client = await held.connect();
    try {
      await client.query("BEGIN");

      await manager.getPool(slugB);

      await client.query("SELECT 1");
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    const again = await held.query<{ one: number }>("SELECT 1 AS one");
    expect(again.rows[0].one).toBe(1);
  });
});
