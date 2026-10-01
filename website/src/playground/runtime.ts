// The Playground runtime: the real @stratum-hq/lib on PGlite (PostgreSQL in
// WebAssembly). The page imports this module only after the visitor presses
// Start, so PGlite and the library load only then.
import { Stratum } from "@stratum-hq/lib";
import { createPglitePool, createRestrictedPool, type PglitePool } from "@stratum-hq/db-adapters/pglite";

export { ConfigLockedError, PermissionLockedError, StratumError } from "@stratum-hq/lib";
export { createPolicy, enableRLS, withTenantContext } from "@stratum-hq/db-adapters";

// migrate() in @stratum-hq/lib reads the migration files with node:fs, which
// a browser does not have. The build embeds the same files instead.
const MIGRATIONS = import.meta.glob("../../../packages/lib/src/migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export interface PlaygroundRuntime {
  /** The library, connected as the PostgreSQL superuser. */
  stratum: Stratum;
  /** The superuser pool. Row-level security does not apply to it. */
  pool: PglitePool;
  /** The same database as the `stratum_app` role, so row-level security applies. */
  appPool: PglitePool;
  /** The number of migration files that the runtime applied. */
  migrations: number;
  /** Delete every row and every table that a scenario created. */
  reset(): Promise<void>;
}

/**
 * Apply the library migrations in file-name order, one transaction per file.
 *
 * It records each file in `_migrations` with the same table and names as
 * migrate() in @stratum-hq/lib, so the database matches a server install.
 */
async function applyMigrations(pool: PglitePool, onStatus: (message: string) => void): Promise<number> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  const files = Object.entries(MIGRATIONS)
    .map(([file, sql]) => ({ name: file.slice(file.lastIndexOf("/") + 1), sql }))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const [index, file] of files.entries()) {
    onStatus(`Applying migration ${index + 1} of ${files.length}: ${file.name}`);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query("SELECT 1 FROM _migrations WHERE name = $1", [file.name]);
      if (rows.length === 0) {
        await client.query(file.sql);
        await client.query("INSERT INTO _migrations (name) VALUES ($1)", [file.name]);
      }
      await client.query("COMMIT");
      client.release();
    } catch (err) {
      client.release(err as Error);
      throw err;
    }
  }
  return files.length;
}

/**
 * Start PostgreSQL in the browser, apply the library migrations and connect the library.
 *
 * @param onStatus - Receives a progress message for each phase.
 */
export async function startPlayground(onStatus: (message: string) => void): Promise<PlaygroundRuntime> {
  onStatus("Starting PostgreSQL (PGlite)");
  const pool = await createPglitePool();
  const migrations = await applyMigrations(pool, onStatus);
  const appPool = await createRestrictedPool(pool);
  const stratum = new Stratum({ pool });
  await stratum.initialize();

  return {
    stratum,
    pool,
    appPool,
    migrations,
    async reset() {
      await pool.query(`
        DROP TABLE IF EXISTS findings;
        DO $$
        DECLARE tables text;
        BEGIN
          SELECT string_agg(format('%I', tablename), ', ') INTO tables
            FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_migrations';
          IF tables IS NOT NULL THEN
            EXECUTE 'TRUNCATE ' || tables || ' RESTART IDENTITY CASCADE';
          END IF;
        END $$;
      `);
    },
  };
}
