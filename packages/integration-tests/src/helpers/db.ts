import pg from "pg";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEST_DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://stratum_test:stratum_test@localhost:5433/stratum_test";

let pool: pg.Pool | null = null;

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
}

/**
 * Clean all test data (truncate all application tables).
 * Preserves schema and _migrations table.
 *
 * Uses a single TRUNCATE statement to avoid deadlocks when multiple
 * test suites run concurrently (individual TRUNCATEs in a loop can
 * deadlock on cross-table CASCADE locks).
 */
export async function cleanTestData(): Promise<void> {
  const p = getPool();
  const { rows } = await p.query<{ tablename: string }>(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
    AND tablename != '_migrations'
  `);
  if (rows.length === 0) return;
  const tableList = rows.map((r) => `"${r.tablename}"`).join(", ");
  await p.query(`TRUNCATE TABLE ${tableList} CASCADE`);
}
