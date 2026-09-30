import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { Stratum } from "@stratum-hq/lib";
import { assertIsolation, assertConfigInheritance } from "@stratum-hq/test-utils";
import { getPool, closePool, runMigrations } from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

/**
 * Runs the published @stratum-hq/test-utils helpers against a real Stratum
 * schema and real RLS policies, as a NON-superuser NOBYPASSRLS role where RLS
 * has to be exercised, so a pass means the property actually held.
 */

const BASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://stratum_test:stratum_test@localhost:5433/stratum_test";

const APP_ROLE = "stratum_tu_app_test";
const appUrl = (() => {
  const u = new URL(BASE_URL);
  u.username = APP_ROLE;
  u.password = APP_ROLE;
  return u.toString();
})();

let appPool: pg.Pool;
let stratum: Stratum;
let parentId: string;
let childId: string;
const tenantA = "00000000-0000-4000-8000-00000000000a";
const tenantB = "00000000-0000-4000-8000-00000000000b";

beforeAll(async () => {
  await runMigrations();
  const pool = getPool();
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
        CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_ROLE}' NOSUPERUSER NOBYPASSRLS;
      END IF;
    END $$;
  `);

  // A conventional tenant-scoped table: UUID primary key, tenant_id column,
  // FORCE RLS keyed on app.current_tenant_id.
  await pool.query(`
    DROP TABLE IF EXISTS tu_orders;
    CREATE TABLE tu_orders (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tenant_id UUID NOT NULL,
      note TEXT
    );
    ALTER TABLE tu_orders ENABLE ROW LEVEL SECURITY;
    ALTER TABLE tu_orders FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON tu_orders
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
  `);

  // A table whose read policy denies everyone. Nothing is isolated here in
  // any useful sense: an isolation check must not report it as a pass.
  await pool.query(`
    DROP TABLE IF EXISTS tu_blind;
    CREATE TABLE tu_blind (
      id TEXT PRIMARY KEY,
      tenant_id UUID DEFAULT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    );
    ALTER TABLE tu_blind ENABLE ROW LEVEL SECURITY;
    ALTER TABLE tu_blind FORCE ROW LEVEL SECURITY;
    CREATE POLICY blind_read ON tu_blind FOR SELECT USING (false);
    CREATE POLICY open_write ON tu_blind FOR INSERT WITH CHECK (true);
  `);
  await pool.query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
  await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON tu_orders, tu_blind TO ${APP_ROLE}`);

  appPool = new pg.Pool({ connectionString: appUrl, max: 2 });

  stratum = new Stratum({ pool });
  const parent = await stratum.createTenant({ name: "TU parent", slug: uniqueSlug("tu_parent") });
  const child = await stratum.createTenant({ name: "TU child", slug: uniqueSlug("tu_child"), parent_id: parent.id });
  parentId = parent.id;
  childId = child.id;
});

afterAll(async () => {
  const pool = getPool();
  await appPool?.end();
  await pool.query(`DROP TABLE IF EXISTS tu_orders, tu_blind`);
  await pool.query(`DELETE FROM config_entries WHERE tenant_id IN ($1, $2)`, [childId, parentId]);
  await pool.query(`DELETE FROM tenants WHERE id = $1`, [childId]);
  await pool.query(`DELETE FROM tenants WHERE id = $1`, [parentId]);
  await pool.query(`REVOKE ALL ON SCHEMA public FROM ${APP_ROLE}`);
  await closePool();
});

describe("assertIsolation against real RLS", () => {
  it("passes on a UUID-keyed table whose policy isolates tenants", async () => {
    await expect(assertIsolation(appPool, tenantA, tenantB, "tu_orders")).resolves.toBeUndefined();
  });

  it("fails when the connection bypasses RLS", async () => {
    // The test connection is a superuser, which ignores RLS: tenant A can read
    // tenant B's row, and the helper must say so.
    await expect(assertIsolation(getPool(), tenantA, tenantB, "tu_orders")).rejects.toThrow(
      /was able to read/,
    );
  });

  it("does not report a pass when tenant B cannot read its own row", async () => {
    await expect(assertIsolation(appPool, tenantA, tenantB, "tu_blind")).rejects.toThrow(/positive control/);
  });
});

describe("assertConfigInheritance against a real Stratum schema", () => {
  it("passes when config inherits, overrides and locks as documented", async () => {
    await expect(
      assertConfigInheritance(stratum, parentId, childId, `tu_key_${Date.now()}`),
    ).resolves.toBeUndefined();
  });

  it("leaves no config entries behind", async () => {
    const key = `tu_clean_${Date.now()}`;
    await assertConfigInheritance(stratum, parentId, childId, key);
    const res = await getPool().query(`SELECT 1 FROM config_entries WHERE key = $1`, [key]);
    expect(res.rowCount).toBe(0);
  });
});
