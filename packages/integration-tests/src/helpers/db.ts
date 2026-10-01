import pg from "pg";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEST_DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://stratum_test:stratum_test@localhost:5433/stratum_test";

let pool: pg.Pool | null = null;

/**
 * Admin mode (STRATUM_IT_ADMIN_POOL=1): the suites pass `adminPool` to
 * Stratum, a login that is NOT a superuser and has no BYPASSRLS, and that
 * reaches the Stratum tables only as a member of the control role
 * (migration 032). The library then sets no app.bypass_rls of its own, so
 * every library call proves the control role is enough. getPool() stays the
 * superuser connection the suites use for fixtures and assertions.
 *
 * The admin login is `<STRATUM_IT_ROLE_PREFIX>lib_admin` (default prefix
 * stratum_it_). runMigrations() creates it and grants it the control role.
 * Roles are cluster-wide; drop it after the run.
 */
const ADMIN_MODE = process.env.STRATUM_IT_ADMIN_POOL === "1";
const ADMIN_ROLE = `${process.env.STRATUM_IT_ROLE_PREFIX || "stratum_it_"}lib_admin`;
const ADMIN_PASSWORD = "lib_admin_pw";
let adminPool: pg.Pool | null = null;
let adminReady = false;

/** The admin pool in admin mode, otherwise undefined (Stratum's legacy single-pool mode). */
export function getAdminPool(): pg.Pool | undefined {
  if (!ADMIN_MODE) return undefined;
  if (!adminReady) {
    throw new Error("STRATUM_IT_ADMIN_POOL=1: call runMigrations() before getAdminPool()");
  }
  if (!adminPool) {
    const u = new URL(TEST_DATABASE_URL);
    u.username = ADMIN_ROLE;
    u.password = ADMIN_PASSWORD;
    adminPool = new pg.Pool({ connectionString: u.toString(), max: 5, idleTimeoutMillis: 5000 });
  }
  return adminPool;
}

/** Creates the admin login and makes it a member of the control role. */
async function prepareAdminRole(p: pg.Pool): Promise<void> {
  const db = new URL(TEST_DATABASE_URL).pathname.slice(1);
  const control = await p.query<{ role: string }>(
    `SELECT DISTINCT r::text AS role FROM pg_policies p, unnest(p.roles) r
      WHERE p.policyname = 'stratum_control_plane'`,
  );
  if (control.rows.length !== 1) {
    throw new Error("STRATUM_IT_ADMIN_POOL=1 needs migration 032 and exactly one control role");
  }
  await p.query(`DO $$ BEGIN
    CREATE ROLE "${ADMIN_ROLE}" LOGIN PASSWORD '${ADMIN_PASSWORD}' NOSUPERUSER NOBYPASSRLS CREATEDB;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
  await p.query(`GRANT "${control.rows[0].role}" TO "${ADMIN_ROLE}" WITH INHERIT TRUE, SET TRUE`);
  // Schema-per-tenant isolation creates schemas in this database.
  await p.query(`GRANT CREATE ON DATABASE "${db}" TO "${ADMIN_ROLE}"`);
  adminReady = true;
}

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: TEST_DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 5000,
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (adminPool) {
    await adminPool.end();
    adminPool = null;
  }
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Run all migrations against the test database.
 * Mirrors the control-plane migration runner logic.
 */
export async function runMigrations(): Promise<void> {
  const p = getPool();

  // Create extensions required by Stratum
  await p.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
  await p.query(`CREATE EXTENSION IF NOT EXISTS "ltree"`);

  // Create _migrations table if not exists
  await p.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // Find migration files
  const migrationsDir = path.resolve(
    __dirname,
    "../../../../packages/lib/src/migrations",
  );

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    // Check if already applied
    const applied = await p.query(
      "SELECT 1 FROM _migrations WHERE name = $1",
      [file],
    );
    if (applied.rows.length > 0) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");

    // Skip empty / comment-only migrations (like the neutered 011)
    const meaningful = sql
      .split("\n")
      .filter(
        (line) => !line.trim().startsWith("--") && line.trim().length > 0,
      );

    if (meaningful.length > 0) {
      // Skip the BYPASSRLS check in 001_init.sql for test user
      const safeSql = sql.replace(
        /DO \$\$ BEGIN[\s\S]*?END \$\$;/,
        "-- BYPASSRLS check skipped in test environment",
      );
      await p.query(safeSql);
    }

    await p.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
  }

  if (ADMIN_MODE && !adminReady) await prepareAdminRole(p);
}

/**
 * Clean all test data (delete from all application tables).
 * Preserves schema and _migrations table.
 *
 * Uses DELETE instead of TRUNCATE to avoid deadlocks. TRUNCATE takes
 * AccessExclusiveLock on every referenced table (including via CASCADE),
 * which deadlocks when concurrent test suites hold read locks. DELETE
 * takes row-level locks only, eliminating the deadlock window.
 *
 * Tables are deleted in reverse-dependency order (children before parents)
 * to respect foreign key constraints without needing CASCADE.
 */
export async function cleanTestData(): Promise<void> {
  const p = getPool();
  // Delete in reverse-dependency order: leaf tables first, then parents.
  // This avoids FK violations without CASCADE (which would require TRUNCATE).
  const tables = [
    "dlq_events",
    "webhook_deliveries",
    "webhooks",
    "abac_policies",
    "permission_policies",
    "config_entries",
    "consent_records",
    "usage_events",
    "audit_logs",
    "api_key_roles",
    "api_keys",
    "roles",
    // tenants.region_id REFERENCES regions(id) (RESTRICT), so tenants (the
    // child) must be deleted before regions (the parent). Any test that assigns
    // a region via migrateRegion would otherwise leave an undeletable region.
    "tenants",
    "regions",
  ];
  for (const table of tables) {
    await p.query(`DELETE FROM "${table}" WHERE 1=1`).catch(() => {
      // Table may not exist yet (e.g., abac_policies before migration 017)
    });
  }
}
