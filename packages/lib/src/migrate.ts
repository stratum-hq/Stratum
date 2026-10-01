import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { assertRoleName, isSuperuser, migrationSql, setControlRole } from "./migration-sql.js";

export interface MigrateOptions {
  pool: pg.Pool;
  /** When true, SET stratum.enforce_rls = 'on' before running migrations (hard-fail on BYPASSRLS). */
  enforceRls?: boolean;
  /**
   * The name of the NOLOGIN control role that migration 032 creates and names
   * in its policies. Default: the stratum.control_role setting of the session
   * (for example from ALTER DATABASE ... SET), then the role the database
   * already uses, then `stratum_control`. Roles are cluster-wide, so set it
   * when several databases on one server need separate control roles.
   */
  controlRole?: string;
}

export async function migrate(options: MigrateOptions): Promise<void> {
  const { pool, enforceRls, controlRole } = options;
  if (controlRole !== undefined) assertRoleName(controlRole, "control role");

  // Create migrations tracking table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // Get migration files
  const migrationsDir = path.resolve(__dirname, "migrations");
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(
      `Migration files not found at ${migrationsDir}. Ensure the package was built with 'npm run build'.`,
    );
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const superuser = await isSuperuser(pool);

  for (const file of files) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Acquire advisory lock to prevent concurrent migrations
      await client.query("SELECT pg_advisory_xact_lock(8675309)");

      // Re-check if already applied (after lock, to prevent TOCTOU race)
      const { rows } = await client.query(
        "SELECT 1 FROM _migrations WHERE name = $1",
        [file],
      );
      if (rows.length > 0) {
        await client.query("COMMIT");
        continue;
      }

      // Set RLS enforcement mode if requested
      if (enforceRls) {
        await client.query("SET LOCAL stratum.enforce_rls = 'on'");
      }
      await setControlRole(client, controlRole);

      const sql = migrationSql(file, fs.readFileSync(path.join(migrationsDir, file), "utf-8"), superuser);
      await client.query(sql);
      await client.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch { /* ignore rollback failure */ }
      throw err;
    } finally {
      client.release();
    }
  }
}
