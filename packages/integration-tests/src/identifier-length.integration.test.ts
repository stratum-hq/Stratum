import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type pg from "pg";
import { SchemaRawAdapter, dropSchema } from "@stratum-hq/db-adapters";
import { getPool, closePool } from "./helpers/db.js";

/**
 * PostgreSQL truncates identifiers to 63 bytes. Slugs may be up to 63
 * characters, so a derived name such as `tenant_<slug>` can exceed the limit.
 * Two long slugs that share a prefix must never resolve to the same schema.
 */

const run = Date.now().toString(36);
const prefix = `lp${run}_`.padEnd(56, "p"); // 56 chars
const slugA = `${prefix}aaaa`; // 60 chars, a valid slug
const slugB = `${prefix}bbbb`; // 60 chars, a valid slug
const truncated = `tenant_${prefix}`; // exactly 63 bytes

let pool: pg.Pool;
let client: pg.PoolClient;

beforeAll(async () => {
  pool = getPool();
  client = await pool.connect();
  // The schema a pre-existing tenant with slugA ended up with.
  await client.query(`CREATE SCHEMA "${truncated}"`);
  await client.query(`CREATE TABLE "${truncated}".widget (name text)`);
  await client.query(`INSERT INTO "${truncated}".widget (name) VALUES ('a-only')`);
});

afterAll(async () => {
  await client.query(`DROP SCHEMA IF EXISTS "${truncated}" CASCADE`);
  client.release();
  await closePool();
});

describe("tenant schema names respect PostgreSQL's identifier limit", () => {
  it("a long slug never resolves to another tenant's schema", async () => {
    expect(slugA).not.toBe(slugB);
    const adapter = new SchemaRawAdapter(pool);
    const seen = await adapter
      .query<{ name: string }>(slugB, `SELECT name FROM widget`)
      .then((r) => r.rows.map((row) => row.name))
      .catch(() => []);
    expect(seen).toEqual([]);
  });

  it("dropSchema for a long slug never drops another tenant's schema", async () => {
    await dropSchema(client, slugB).catch(() => undefined);
    const r = await client.query(`SELECT 1 FROM pg_namespace WHERE nspname = $1`, [truncated]);
    expect(r.rowCount).toBe(1);
  });
});
