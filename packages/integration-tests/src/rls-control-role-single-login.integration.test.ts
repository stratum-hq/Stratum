import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { bootstrapRolesSql, Stratum, type StratumLogger } from "@stratum-hq/lib";
import { BASE_URL, ROLE_PREFIX, dropTestRole, scratchDatabase, urlFor } from "./helpers/role-model.js";

/**
 * A single-login install: one login, which has CREATEROLE (as on many managed
 * PostgreSQL services), runs the migrations and the application. It was
 * migrated up to 031 with 1.7, and upgrades to 032 through autoMigrate
 * without an adminPool. The upgrade must keep the 1.7 behavior: the login is
 * not made a member of the control role, and under a tenant context it
 * still sees only that tenant's rows.
 */

const DB = scratchDatabase("single_login");
const LOGIN = `${ROLE_PREFIX}single_login`;
const CONTROL = `${ROLE_PREFIX}single_control`;
const PASSWORD = "single_pw";
// Overrides a stratum.control_role that PGOPTIONS may set for the whole run.
const CONTROL_OPTION = `-c stratum.control_role=${CONTROL}`;
const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../lib/src/migrations");
const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../cli/dist/index.js");

const A = "00000000-0000-0000-0000-0000000000a1";
const B = "00000000-0000-0000-0000-0000000000b1";

let su: pg.Client;
let suDb: pg.Pool;
let pool: pg.Pool;

function capture(): StratumLogger & { warnings: string[] } {
  const warnings: string[] = [];
  return { warnings, info() {}, error() {}, warn: (msg: string) => warnings.push(msg) };
}

/** Applies the migrations up to and including 031, as `migrate()` of 1.7 did for a login that is not a superuser. */
async function migrateTo031(p: pg.Pool): Promise<void> {
  await p.query(`CREATE TABLE IF NOT EXISTS _migrations (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql") && f < "032").sort();
  for (const file of files) {
    let sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    // A login that is not a superuser cannot put app.* settings on a function.
    if (file.startsWith("029") || file.startsWith("031")) sql = sql.replace(/^SET app\.[a-z_]+ = '[^']*'\n/gm, "");
    await p.query(sql);
    await p.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
  }
}

beforeAll(async () => {
  su = new pg.Client({ connectionString: BASE_URL });
  await su.connect();
  await su.query(`DROP DATABASE IF EXISTS "${DB}"`);
  await dropTestRole(su, LOGIN);
  await dropTestRole(su, CONTROL);
  await su.query(`CREATE ROLE "${LOGIN}" LOGIN PASSWORD '${PASSWORD}' NOSUPERUSER NOBYPASSRLS CREATEROLE`);
  await su.query(`CREATE DATABASE "${DB}" OWNER "${LOGIN}"`);
  // Its own control role name, so that this file never touches a shared role.
  await su.query(`ALTER DATABASE "${DB}" SET stratum.control_role = '${CONTROL}'`);
  suDb = new pg.Pool({ connectionString: urlFor({ database: DB }), max: 2, options: CONTROL_OPTION });
  await suDb.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; CREATE EXTENSION IF NOT EXISTS ltree`);

  pool = new pg.Pool({
    connectionString: urlFor({ user: LOGIN, password: PASSWORD, database: DB }),
    max: 3,
    options: CONTROL_OPTION,
  });
  await migrateTo031(pool);
  // Two tenants with a config entry each, written the way 1.7 did.
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.bypass_rls', 'on', true)");
    await c.query(
      `INSERT INTO tenants (id, name, slug, ancestry_path, depth) VALUES
         ($1, 'A', 'single_a', '/', 0), ($2, 'B', 'single_b', '/', 0)`,
      [A, B],
    );
    await c.query(
      `INSERT INTO config_entries (tenant_id, source_tenant_id, key, value)
         VALUES ($1, $1, 'plan', '"a"'), ($2, $2, 'plan', '"b"')`,
      [A, B],
    );
    await c.query("COMMIT");
  } finally {
    c.release();
  }
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await suDb?.end();
  await su.query(`DROP DATABASE IF EXISTS "${DB}"`);
  await dropTestRole(su, LOGIN);
  await dropTestRole(su, CONTROL);
  await su.end();
});

async function asTenant<T>(tenant: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenant]);
    return await fn(c);
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    c.release();
  }
}

describe("a single-login install with CREATEROLE upgrading to 032 without adminPool", () => {
  it("applies 032 through autoMigrate and warns that the hardening is not active", async () => {
    const logger = capture();
    await new Stratum({ pool, autoMigrate: true, logger }).initialize();
    const applied = await pool.query("SELECT 1 FROM _migrations WHERE name = '032_control_role.sql'");
    expect(applied.rows).toHaveLength(1);
    expect(logger.warnings.join("\n")).toMatch(/hardening is not active/);
  });

  it("does not make the login a member of the control role", async () => {
    const res = await suDb.query(
      `SELECT EXISTS (SELECT 1 FROM pg_roles c WHERE c.rolname = $2 AND pg_has_role($1, c.oid, 'MEMBER')) AS member`,
      [LOGIN, CONTROL],
    );
    expect(res.rows[0].member).toBe(false);
  });

  it("still limits the login to the current tenant's rows", async () => {
    const tenants = await asTenant(A, (c) => c.query("SELECT id FROM tenants ORDER BY id"));
    expect(tenants.rows).toEqual([{ id: A }]);
    const config = await asTenant(B, (c) => c.query("SELECT tenant_id FROM config_entries"));
    expect(config.rows).toEqual([{ tenant_id: B }]);
  });

  it("keeps the library working in single-pool mode, as in 1.7", async () => {
    const stratum = new Stratum({ pool, logger: capture() });
    const child = await stratum.createTenant({ name: "A child", slug: "single_a_child", parent_id: A });
    expect((await stratum.getAncestors(child.id)).map((t) => t.id)).toEqual([A]);
  });
});

describe("a pool login that is a member of the control role", () => {
  beforeAll(async () => {
    // A DBA applies the control role and, by mistake, grants it to the
    // single login.
    await suDb.query(bootstrapRolesSql({ controlRole: CONTROL }));
    await suDb.query(`GRANT "${CONTROL}" TO "${LOGIN}"`);
  });

  it("makes initialize() warn in single-pool mode", async () => {
    const logger = capture();
    await new Stratum({ pool, logger }).initialize();
    expect(logger.warnings.join("\n")).toMatch(/member of the control role/);
  });

  it("makes initialize() throw with enforceRls", async () => {
    await expect(new Stratum({ pool, enforceRls: true, logger: capture() }).initialize()).rejects.toThrow(
      /member of the control role/,
    );
  });

  it("makes stratum db lock refuse", () => {
    const res = spawnSync(
      process.execPath,
      [
        CLI, "db", "lock",
        "--admin-database-url", urlFor({ database: DB }),
        "--database-url", urlFor({ user: LOGIN, password: PASSWORD, database: DB }),
      ],
      {
        encoding: "utf8",
        env: { ...process.env, NO_COLOR: "1", DATABASE_ADMIN_URL: "", PGOPTIONS: CONTROL_OPTION },
        timeout: 30000,
      },
    );
    expect(res.status, `${res.stdout}${res.stderr}`).not.toBe(0);
    expect(`${res.stdout}${res.stderr}`).toMatch(/is a member of the control role/);
  });
});
