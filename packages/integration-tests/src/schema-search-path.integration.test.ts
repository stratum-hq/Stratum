import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type pg from "pg";
import {
  SchemaRawAdapter,
  createSchemaTenantPool,
  tenantSchemaName,
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
// A schema holding an extension-style function, the way uuid-ossp or ltree
// objects often live in a shared schema.
const extSchema = `ext_${uniqueSlug("sp")}`;

beforeAll(async () => {
  pool = getPool();
  client = await pool.connect();
  await client.query(`DROP TABLE IF EXISTS public.gadget`);
  await client.query(`CREATE TABLE public.gadget (name text)`);
  // Freshly provisioned tenant schemas with no tables replicated yet.
  await createSchema(client, slugA);
  await createSchema(client, slugB);
  await client.query(`CREATE SCHEMA ${extSchema}`);
  await client.query(
    `CREATE FUNCTION ${extSchema}.ext_answer() RETURNS int LANGUAGE sql AS 'SELECT 42'`,
  );
});

afterAll(async () => {
  await dropSchema(client, slugA).catch(() => {});
  await dropSchema(client, slugB).catch(() => {});
  await client.query(`DROP SCHEMA IF EXISTS ${extSchema} CASCADE`);
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

  describe("extraSearchPath opt-in", () => {
    it("by default does not resolve functions outside the tenant schema", async () => {
      const adapter = new SchemaRawAdapter(pool);
      await expect(adapter.query(slugA, `SELECT ext_answer() AS v`)).rejects.toThrow(
        /does not exist/,
      );
    });

    it("SchemaRawAdapter resolves a function from an opted-in extra schema", async () => {
      const adapter = new SchemaRawAdapter(pool, { extraSearchPath: [extSchema] });
      const res = await adapter.query<{ v: number }>(slugA, `SELECT ext_answer() AS v`);
      expect(res.rows[0].v).toBe(42);
    });

    it("createSchemaTenantPool passes the extra schemas through", async () => {
      const tenantPool = createSchemaTenantPool(pool, () => slugA, { extraSearchPath: [extSchema] });
      // The proxy binds the tenant slug, so query takes only the SQL text.
      const bound = tenantPool as unknown as { query(text: string): Promise<pg.QueryResult> };
      const res = await bound.query(`SELECT ext_answer() AS v`);
      expect(res.rows[0].v).toBe(42);
    });

    it("setSchemaSearchPath puts extra schemas after the tenant schema", async () => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await setSchemaSearchPath(c, slugA, [extSchema]);
        const path = await c.query<{ search_path: string }>(`SHOW search_path`);
        expect(path.rows[0].search_path).toBe(`${tenantSchemaName(slugA)}, ${extSchema}`);
        const res = await c.query<{ v: number }>(`SELECT ext_answer() AS v`);
        expect(res.rows[0].v).toBe(42);
        // A table missing from the tenant schema still does not reach public.
        await expect(c.query(`SELECT name FROM gadget`)).rejects.toThrow(/does not exist/);
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    });

    it.each(["public; DROP TABLE gadget", "a b", "x\"y", "1abc", ""])(
      "rejects an invalid extra schema entry (%s)",
      async (bad) => {
        expect(() => new SchemaRawAdapter(pool, { extraSearchPath: [bad] })).toThrow(
          /invalid schema name/i,
        );
        const c = await pool.connect();
        try {
          await c.query("BEGIN");
          await expect(setSchemaSearchPath(c, slugA, [bad])).rejects.toThrow(/invalid schema name/i);
        } finally {
          await c.query("ROLLBACK");
          c.release();
        }
      },
    );
  });
});
