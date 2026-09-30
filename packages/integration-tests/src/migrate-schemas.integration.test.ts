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

  appPool = new pg.Pool({ connectionString: URL, max: 2 });
  appPool.on("connect", (c) => {
    c.query(`SET ROLE ${APP_ROLE}`).catch(() => {});
  });
});

afterAll(async () => {
  await appPool.end();
  const admin = getPool();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  await closePool();
});

describe("migrateAllSchemas under a NOBYPASSRLS role", () => {
  it("discovers every SCHEMA_PER_TENANT tenant schema", async () => {
    const result = await migrateAllSchemas({ pool: appPool });
    const discovered = [...result.succeeded, ...result.failed.map((f) => f.schema)];
    expect(discovered).toContain(schema);
  });
});
