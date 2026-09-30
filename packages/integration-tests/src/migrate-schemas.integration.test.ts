import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { migrateAllSchemas } from "@stratum-hq/lib";
import { getPool, closePool, runMigrations } from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

/**
 * migrateAllSchemas must discover SCHEMA_PER_TENANT tenants when it runs as the
 * recommended production role: NOSUPERUSER NOBYPASSRLS, with FORCE RLS on the
 * tenants table (migration 019).
 */

const APP_ROLE = "stratum_migrate_schemas_test";
const URL = process.env.DATABASE_URL ||
  "postgresql://stratum_test:stratum_test@localhost:5433/stratum_test";

const slug = uniqueSlug("msch");
const schema = `tenant_${slug}`;
let tenantId: string;

// A SCHEMA_PER_TENANT tenant whose schema was never provisioned.
const missingSlug = uniqueSlug("msch_missing");
// A tenant whose derived schema name exceeds 63 bytes, and the 63-byte schema
// PostgreSQL would truncate that name to (owned by some other tenant).
const longSlug = `${uniqueSlug("msch_long")}_`.padEnd(60, "x");
const truncatedSchema = `tenant_${longSlug}`.slice(0, 63);
const extraTenantIds: string[] = [];
let appPool: pg.Pool;

beforeAll(async () => {
  await runMigrations();
  const admin = getPool();
  await admin.query(`DO $$ BEGIN
    CREATE ROLE ${APP_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
  await admin.query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
  await admin.query(`GRANT SELECT ON tenants TO ${APP_ROLE}`);
  const res = await admin.query<{ id: string }>(
    `INSERT INTO tenants (name, slug, ancestry_path, isolation_strategy)
     VALUES ($1, $1, $1, 'SCHEMA_PER_TENANT') RETURNING id`,
    [slug],
  );
  tenantId = res.rows[0].id;
  await admin.query(`CREATE SCHEMA ${schema}`);
  for (const extra of [missingSlug, longSlug]) {
    const r = await admin.query<{ id: string }>(
      `INSERT INTO tenants (name, slug, ancestry_path, isolation_strategy)
       VALUES ($1, $1, $1, 'SCHEMA_PER_TENANT') RETURNING id`,
      [extra],
    );
    extraTenantIds.push(r.rows[0].id);
  }
  await admin.query(`CREATE SCHEMA "${truncatedSchema}"`);

  appPool = new pg.Pool({ connectionString: URL, max: 2 });
  appPool.on("connect", (c) => {
    c.query(`SET ROLE ${APP_ROLE}`).catch(() => {});
  });
});

afterAll(async () => {
  await appPool.end();
  const admin = getPool();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.query(`DROP SCHEMA IF EXISTS "${truncatedSchema}" CASCADE`);
  await admin.query(`DELETE FROM tenants WHERE id = ANY($1)`, [[tenantId, ...extraTenantIds]]);
  await closePool();
});

describe("migrateAllSchemas under a NOBYPASSRLS role", () => {
  it("discovers every SCHEMA_PER_TENANT tenant schema", async () => {
    const result = await migrateAllSchemas({ pool: appPool });
    const discovered = [...result.succeeded, ...result.failed.map((f) => f.schema)];
    expect(discovered).toContain(schema);
  });
});

describe("migrateAllSchemas per-schema safety", () => {
  it("reports a tenant whose schema does not exist as failed instead of using public", async () => {
    const admin = getPool();
    const before = await admin.query<{ n: string }>(`SELECT count(*)::text AS n FROM public._migrations`);
    const result = await migrateAllSchemas({ pool: admin });

    expect(result.succeeded).not.toContain(`tenant_${missingSlug}`);
    expect(result.failed.map((f) => f.schema)).toContain(`tenant_${missingSlug}`);
    const after = await admin.query<{ n: string }>(`SELECT count(*)::text AS n FROM public._migrations`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("never migrates the schema a too-long tenant schema name would truncate to", async () => {
    const admin = getPool();
    const result = await migrateAllSchemas({ pool: admin });

    expect(result.succeeded.some((s) => s.startsWith(truncatedSchema))).toBe(false);
    const tables = await admin.query(
      `SELECT 1 FROM pg_tables WHERE schemaname = $1`,
      [truncatedSchema],
    );
    expect(tables.rowCount).toBe(0);
  });
});
