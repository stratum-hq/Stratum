import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRequire } from "node:module";
import pg from "pg";
import { bootstrapRolesSql, noopLogger, Stratum } from "@stratum-hq/lib";
import { BASE_URL, ROLE_PREFIX, controlRoleName, dropTestRole, errorCode, scratchDatabase, urlFor } from "./helpers/role-model.js";

/**
 * The control plane with and without DATABASE_ADMIN_URL, on real PostgreSQL.
 *
 * With it, the migrations and the library run on the admin login, a member of
 * the control role that is neither superuser nor BYPASSRLS, and the
 * application login of DATABASE_URL has only the recommended read grants.
 * The legacy app.bypass_rls switch is off, so every request proves that the
 * control plane no longer depends on it.
 *
 * Without it, the control plane migrates and serves on DATABASE_URL as in
 * earlier releases.
 */

process.env.JWT_SECRET = "integration-test-jwt-secret";
process.env.RATE_LIMIT_MAX = "1000";

type ControlPlaneApp = typeof import("../../control-plane/dist/app.js");
type ControlPlaneDb = typeof import("../../control-plane/dist/db/connection.js");
type ControlPlaneMigrate = typeof import("../../control-plane/dist/db/migrate.js");

const PASSWORD = "cp_admin_pw";
const ADMIN = `${ROLE_PREFIX}cp_admin`;
const APP = `${ROLE_PREFIX}cp_app`;
const DB_ADMIN_MODE = scratchDatabase("cp_admin_pool");
const DB_LEGACY_MODE = scratchDatabase("cp_single_pool");

let su: pg.Client;
let cpApp: ControlPlaneApp;
let cpDb: ControlPlaneDb;
let cpMigrate: ControlPlaneMigrate;
const savedEnv = { DATABASE_URL: process.env.DATABASE_URL, DATABASE_ADMIN_URL: process.env.DATABASE_ADMIN_URL };

/** A global admin-scoped key, minted through the library on `adminPool` (or `pool` alone). */
async function operatorKey(dbUrl: string, pool: pg.Pool, adminPool?: pg.Pool): Promise<string> {
  const stratum = new Stratum({ pool, adminPool, logger: noopLogger });
  const key = await stratum.createApiKey(null, "operator");
  const suPool = new pg.Pool({ connectionString: dbUrl, max: 1 });
  try {
    await suPool.query("UPDATE api_keys SET scopes = $2 WHERE id = $1", [key.id, ["read", "write", "admin"]]);
  } finally {
    await suPool.end();
  }
  return key.plaintext_key;
}

beforeAll(async () => {
  su = new pg.Client({ connectionString: BASE_URL });
  await su.connect();
  for (const db of [DB_ADMIN_MODE, DB_LEGACY_MODE]) await su.query(`DROP DATABASE IF EXISTS "${db}"`);
  for (const role of [ADMIN, APP]) await dropTestRole(su, role);
  await su.query(`CREATE ROLE "${ADMIN}" LOGIN PASSWORD '${PASSWORD}' NOSUPERUSER NOBYPASSRLS CREATEDB`);
  await su.query(`CREATE ROLE "${APP}" LOGIN PASSWORD '${PASSWORD}' NOSUPERUSER NOBYPASSRLS`);
  for (const db of [DB_ADMIN_MODE, DB_LEGACY_MODE]) await su.query(`CREATE DATABASE "${db}"`);
  // The control plane is CommonJS. Load all three modules through Node's
  // require, so that they share one instance of the connection module and
  // closePool() resets the pools the app and the migrations use.
  const require = createRequire(import.meta.url);
  cpApp = require("../../control-plane/dist/app.js");
  cpDb = require("../../control-plane/dist/db/connection.js");
  cpMigrate = require("../../control-plane/dist/db/migrate.js");
}, 60_000);

afterAll(async () => {
  await cpDb?.closePool();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const db of [DB_ADMIN_MODE, DB_LEGACY_MODE]) await su.query(`DROP DATABASE IF EXISTS "${db}"`);
  for (const role of [ADMIN, APP]) await dropTestRole(su, role);
  await su.end();
});

describe("control plane with DATABASE_ADMIN_URL", () => {
  const suUrl = urlFor({ database: DB_ADMIN_MODE });
  const adminUrl = urlFor({ user: ADMIN, password: PASSWORD, database: DB_ADMIN_MODE });
  const appUrl = urlFor({ user: APP, password: PASSWORD, database: DB_ADMIN_MODE });
  let suPool: pg.Pool;
  let app: Awaited<ReturnType<ControlPlaneApp["buildApp"]>>;
  let key: string;

  beforeAll(async () => {
    suPool = new pg.Pool({ connectionString: suUrl, max: 2 });
    const control = await controlRoleName(suPool);
    // What a DBA does once, before the first deployment (docker/init-db.sql does the same).
    await suPool.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await suPool.query(`CREATE EXTENSION IF NOT EXISTS ltree`);
    await suPool.query(`GRANT CREATE ON DATABASE "${DB_ADMIN_MODE}" TO "${ADMIN}"`);
    await suPool.query(`GRANT USAGE, CREATE ON SCHEMA public TO "${ADMIN}"`);
    await suPool.query(bootstrapRolesSql({ adminRole: ADMIN, controlRole: control }));

    process.env.DATABASE_URL = appUrl;
    process.env.DATABASE_ADMIN_URL = adminUrl;
    await cpDb.closePool();
    await cpMigrate.migrate();

    // After the migrations: the application login gets the read grants, and the legacy path closes.
    await suPool.query(bootstrapRolesSql({ adminRole: ADMIN, appRole: APP, controlRole: control }));
    await suPool.query("UPDATE stratum_security SET legacy_guc_bypass = false");

    const adminPool = cpDb.getAdminPool();
    expect(adminPool).toBeDefined();
    key = await operatorKey(suUrl, cpDb.getPool(), adminPool);
    app = await cpApp.buildApp();
    app.log.level = "silent";
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await cpDb.closePool();
    await suPool?.end();
  });

  it("migrates as the admin login, which owns the Stratum tables, and applies the control role", async () => {
    const res = await suPool.query(
      `SELECT tableowner,
              (SELECT count(*)::int FROM pg_policies WHERE policyname = 'stratum_control_plane') AS control_policies
         FROM pg_tables WHERE schemaname = 'public' AND tablename = 'tenants'`,
    );
    expect(res.rows[0].tableowner).toBe(ADMIN);
    expect(res.rows[0].control_policies).toBeGreaterThan(0);
  });

  it("reports both pools in the health check", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ db: "connected", admin_db: "connected" });
  });

  it("authenticates a key and creates and reads tenants with the legacy switch off", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/tenants",
      headers: { "x-api-key": key },
      payload: { name: "Admin pool tenant", slug: "cp_admin_pool_t" },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().id as string;
    const read = await app.inject({ method: "GET", url: `/api/v1/tenants/${id}`, headers: { "x-api-key": key } });
    expect(read.statusCode).toBe(200);
    expect(read.json().slug).toBe("cp_admin_pool_t");
  });

  it("keeps the application login of DATABASE_URL away from the API keys", async () => {
    expect(await errorCode(() => cpDb.getPool().query("SELECT count(*) FROM api_keys"))).toBe("42501");
  });
});

describe("control plane without DATABASE_ADMIN_URL", () => {
  const suUrl = urlFor({ database: DB_LEGACY_MODE });
  let app: Awaited<ReturnType<ControlPlaneApp["buildApp"]>>;
  let key: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = suUrl;
    delete process.env.DATABASE_ADMIN_URL;
    await cpDb.closePool();
    await cpMigrate.migrate();
    expect(cpDb.getAdminPool()).toBeUndefined();
    key = await operatorKey(suUrl, cpDb.getPool());
    app = await cpApp.buildApp();
    app.log.level = "silent";
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await cpDb.closePool();
  });

  it("reports the one pool in the health check, as before", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(res.json().db).toBe("connected");
    expect(res.json()).not.toHaveProperty("admin_db");
  });

  it("creates and reads tenants on DATABASE_URL, as before", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/tenants",
      headers: { "x-api-key": key },
      payload: { name: "Single pool tenant", slug: "cp_single_pool_t" },
    });
    expect(created.statusCode, created.body).toBe(201);
    const list = await app.inject({ method: "GET", url: "/api/v1/tenants", headers: { "x-api-key": key } });
    expect(list.statusCode).toBe(200);
    expect(JSON.stringify(list.json())).toContain("cp_single_pool_t");
  });
});
