import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type pg from "pg";
import {
  SchemaRawAdapter,
  createSchema,
  dropSchema,
  setSchemaSearchPath,
} from "@stratum-hq/db-adapters";
import { getPool, closePool } from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

/**
 * A tenant's search_path must resolve only to the tenant's own schema. A table
 * missing from the tenant schema must be an error, not a silent fallback to a
 * table every tenant shares.
 */

let pool: pg.Pool;
let client: pg.PoolClient;
const slugA = uniqueSlug("sp_path_a");
const slugB = uniqueSlug("sp_path_b");

beforeAll(async () => {
  pool = getPool();
  client = await pool.connect();
  await client.query(`DROP TABLE IF EXISTS public.gadget`);
  await client.query(`CREATE TABLE public.gadget (name text)`);
  // Freshly provisioned tenant schemas with no tables replicated yet.
  await createSchema(client, slugA);
  await createSchema(client, slugB);
});

afterAll(async () => {
  await dropSchema(client, slugA).catch(() => {});
  await dropSchema(client, slugB).catch(() => {});
  await client.query(`DROP TABLE IF EXISTS public.gadget`);
  client.release();
  await closePool();
});

describe("schema-per-tenant search_path", () => {
  it("does not fall back to shared public tables missing from the tenant schema", async () => {
    const adapter = new SchemaRawAdapter(pool);
    await adapter
      .query(slugA, `INSERT INTO gadget (name) VALUES ('a-only')`)
      .catch(() => undefined);
    const seenByB = await adapter
      .query<{ name: string }>(slugB, `SELECT name FROM gadget`)
      .then((r) => r.rows.map((row) => row.name))
      .catch(() => []);

    const pub = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.gadget`);
    expect(pub.rows[0].n).toBe("0");
    expect(seenByB).toEqual([]);
  });

  it("setSchemaSearchPath refuses to run outside a transaction", async () => {
    const c = await pool.connect();
    try {
      await expect(setSchemaSearchPath(c, slugA)).rejects.toThrow(/transaction/i);
    } finally {
      await c.query("RESET search_path");
      c.release();
    }
  });

  it("setSchemaSearchPath scopes the transaction to the tenant schema only", async () => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await setSchemaSearchPath(c, slugA);
      await expect(c.query(`SELECT name FROM gadget`)).rejects.toThrow(/does not exist/);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  });
});
