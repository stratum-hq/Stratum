import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type pg from "pg";
import {
  SchemaRawAdapter,
  createSchema,
  dropSchema,
  schemaExists,
  listTenantSchemas,
  replicateTableToSchema,
  tenantSchemaName,
} from "@stratum-hq/db-adapters";
import { getPool, closePool } from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

/**
 * The DB_SCHEMA isolation strategy is only proven at the unit level against a
 * mocked pool, which cannot show that per-tenant schemas actually isolate data.
 * RLS isolation has a real-Postgres proof (rls-enforcement); schema-per-tenant
 * did not. This drives the public db-adapters schema surface against a real
 * database and asserts that a write scoped to one tenant's schema is invisible
 * to another — the actual isolation guarantee.
 */
describe("schema-per-tenant isolation against real Postgres (integration)", () => {
  let pool: pg.Pool;
  let client: pg.PoolClient;
  const slugA = uniqueSlug("schema_a");
  const slugB = uniqueSlug("schema_b");

  beforeAll(async () => {
    pool = getPool();
    client = await pool.connect();
    // A public template table the per-tenant copies are cloned from.
    await client.query(`CREATE TABLE IF NOT EXISTS public.widget (name text)`);
  });

  afterAll(async () => {
    await dropSchema(client, slugA).catch(() => {});
    await dropSchema(client, slugB).catch(() => {});
    await client.query(`DROP TABLE IF EXISTS public.widget`);
    client.release();
    await closePool();
  });

  it("createSchema / schemaExists / listTenantSchemas reflect real schemas", async () => {
    expect(await schemaExists(client, slugA)).toBe(false);

    await createSchema(client, slugA);
    await createSchema(client, slugB);

    expect(await schemaExists(client, slugA)).toBe(true);
    expect(await schemaExists(client, slugB)).toBe(true);
    expect(await schemaExists(client, uniqueSlug("never"))).toBe(false);

    const schemas = await listTenantSchemas(client);
    expect(schemas).toEqual(
      expect.arrayContaining([tenantSchemaName(slugA), tenantSchemaName(slugB)]),
    );
    // createSchema is idempotent (CREATE SCHEMA IF NOT EXISTS).
    await expect(createSchema(client, slugA)).resolves.toBeUndefined();
  });

  it("isolates writes: each tenant's schema sees only its own rows", async () => {
    await replicateTableToSchema(client, "widget", tenantSchemaName(slugA));
    await replicateTableToSchema(client, "widget", tenantSchemaName(slugB));

    const adapter = new SchemaRawAdapter(pool);
    await adapter.query(slugA, `INSERT INTO widget (name) VALUES ($1)`, ["a-only"]);
    await adapter.query(slugB, `INSERT INTO widget (name) VALUES ($1)`, ["b-only"]);

    const aRows = await adapter.query<{ name: string }>(slugA, `SELECT name FROM widget`);
    const bRows = await adapter.query<{ name: string }>(slugB, `SELECT name FROM widget`);

    expect(aRows.rows.map((r) => r.name)).toEqual(["a-only"]);
    expect(bRows.rows.map((r) => r.name)).toEqual(["b-only"]);

    // Nothing leaked into the public template table.
    const pub = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.widget`);
    expect(pub.rows[0].n).toBe("0");
  });

  it("resets search_path after the adapter's transaction so the pooled client is clean", async () => {
    // Run a query through the adapter, then pull the same pool connection and
    // confirm it is not stuck on a tenant search_path.
    const adapter = new SchemaRawAdapter(pool);
    await adapter.query(slugA, `SELECT 1`);

    const probe = await pool.query<{ search_path: string }>(`SHOW search_path`);
    expect(probe.rows[0].search_path).not.toContain(tenantSchemaName(slugA));
  });

  it("rejects a slug that would produce an invalid (injectable) schema name", async () => {
    await expect(createSchema(client, "bad; DROP TABLE widget")).rejects.toThrow(
      /invalid schema name/i,
    );
  });

  it("dropSchema removes the schema", async () => {
    const slug = uniqueSlug("schema_drop");
    await createSchema(client, slug);
    expect(await schemaExists(client, slug)).toBe(true);

    await dropSchema(client, slug);
    expect(await schemaExists(client, slug)).toBe(false);
  });
});
