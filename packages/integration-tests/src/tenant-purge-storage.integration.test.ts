import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import pg from "pg";
import { Stratum } from "@stratum-hq/lib";
import {
  createSchema,
  dropSchema,
  schemaExists,
  tenantSchemaName,
  createDatabase,
  databaseExists,
  dropDatabase,
  getDatabaseName,
} from "@stratum-hq/db-adapters";
import { getPool, closePool, runMigrations, cleanTestData, getAdminPool } from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

/**
 * Purging a SCHEMA_PER_TENANT or DB_PER_TENANT tenant (GDPR Article 17) removes
 * its schema or database as well as its rows, and touches no other tenant's
 * storage. A tenant that never left `pending` has no confirmed storage, so its
 * purge removes only rows.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://stratum_test:stratum_test@localhost:5433/stratum_test";

let stratum: Stratum;
const schemaSlugs: string[] = [];
const databaseSlugs: string[] = [];

beforeAll(async () => {
  await runMigrations();
  stratum = new Stratum({ pool: getPool(), adminPool: getAdminPool() });
});

afterEach(async () => {
  await cleanTestData();
});

afterAll(async () => {
  const c = await getPool().connect();
  try {
    for (const slug of schemaSlugs) await dropSchema(c, slug).catch(() => {});
    for (const slug of databaseSlugs) await dropDatabase(c, slug).catch(() => {});
  } finally {
    c.release();
  }
  await closePool();
});

async function withConn<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await getPool().connect();
  try {
    return await fn(c);
  } finally {
    c.release();
  }
}

/**
 * Provisioning runs on the library's pool, so the role that later purges the
 * storage owns it. In admin mode (helpers/db.ts) that is the admin login.
 */
async function withProvisioningConn<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await (getAdminPool() ?? getPool()).connect();
  try {
    return await fn(c);
  } finally {
    c.release();
  }
}

/** A provisioned, active SCHEMA_PER_TENANT tenant with one row of its own data. */
async function schemaTenant() {
  const slug = uniqueSlug("a9s");
  schemaSlugs.push(slug);
  const t = await stratum.createTenant({ name: slug, slug, isolation_strategy: "SCHEMA_PER_TENANT" });
  await withProvisioningConn(async (c) => {
    await createSchema(c, slug);
    await c.query(`CREATE TABLE ${tenantSchemaName(slug)}.note (body text)`);
    await c.query(`INSERT INTO ${tenantSchemaName(slug)}.note VALUES ('private')`);
  });
  return stratum.activateTenant(t.id);
}

/** A provisioned, active DB_PER_TENANT tenant. */
async function databaseTenant() {
  const slug = uniqueSlug("a9d");
  databaseSlugs.push(slug);
  const t = await stratum.createTenant({ name: slug, slug, isolation_strategy: "DB_PER_TENANT" });
  await withProvisioningConn((c) => createDatabase(c, slug));
  return stratum.activateTenant(t.id);
}

describe("purge removes isolated storage (integration)", () => {
  it("drops the purged tenant's schema and leaves another tenant's schema and data intact", async () => {
    const victim = await schemaTenant();
    const other = await schemaTenant();

    await stratum.purgeTenant(victim.id);

    await withConn(async (c) => {
      expect(await schemaExists(c, victim.slug)).toBe(false);
      expect(await schemaExists(c, other.slug)).toBe(true);
      const rows = await c.query(`SELECT body FROM ${tenantSchemaName(other.slug)}.note`);
      expect(rows.rows).toEqual([{ body: "private" }]);
    });
    const left = await getPool().query("SELECT id FROM tenants WHERE id = ANY($1::uuid[])", [[victim.id, other.id]]);
    expect(left.rows.map((r) => r.id)).toEqual([other.id]);
  });

  it("drops the purged tenant's database and leaves another tenant's database intact", async () => {
    const victim = await databaseTenant();
    const other = await databaseTenant();

    await stratum.purgeTenant(victim.id);

    await withConn(async (c) => {
      expect(await databaseExists(c, victim.slug)).toBe(false);
      expect(await databaseExists(c, other.slug)).toBe(true);
    });
    const tenantDb = new pg.Client({
      connectionString: DATABASE_URL.replace(/\/[^/]+$/, `/${getDatabaseName(other.slug)}`),
    });
    await tenantDb.connect();
    await tenantDb.end();
  });

  it("keeps the tenant and its schema when the purge is refused", async () => {
    const parent = await schemaTenant();
    const childSlug = uniqueSlug("a9s");
    await stratum.createTenant({ name: childSlug, slug: childSlug, parent_id: parent.id });

    await expect(stratum.purgeTenant(parent.id)).rejects.toMatchObject({ code: "TENANT_HAS_CHILDREN" });
    await withConn(async (c) => expect(await schemaExists(c, parent.slug)).toBe(true));
  });

  it("does not drop storage when purging a tenant that is still pending", async () => {
    const slug = uniqueSlug("a9s");
    schemaSlugs.push(slug);
    // Storage under this tenant's name that its own provisioning never
    // confirmed, for example left behind by something else.
    await withConn(async (c) => {
      await createSchema(c, slug);
      await c.query(`CREATE TABLE ${tenantSchemaName(slug)}.note (body text)`);
    });
    const t = await stratum.createTenant({ name: slug, slug, isolation_strategy: "SCHEMA_PER_TENANT" });
    expect(t.status).toBe("pending");

    await stratum.purgeTenant(t.id);

    await withConn(async (c) => expect(await schemaExists(c, slug)).toBe(true));
    const left = await getPool().query("SELECT 1 FROM tenants WHERE id = $1", [t.id]);
    expect(left.rows).toHaveLength(0);
  });
});
