import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { assertRoleName, isSuperuser, migrationSql, setApplyControlRole, setControlRole } from "./migration-sql.js";
import { quoteIdentifier } from "./pinned-query.js";

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
  /**
   * Lets migration 032 create the control role and grant it to the login of
   * `pool`, then apply it. Set it only when `pool` is the library's admin
   * login (the login behind adminPool), never the application's: a member
   * of the control role passes every Stratum policy. Stratum's autoMigrate
   * sets it when it runs on adminPool. Without it, 032 applies the control
   * role only when that grants nothing new (a superuser, or a login that is
   * already a member), and otherwise warns with the SQL to run.
   */
  applyControlRole?: boolean;
}

/**
 * Throws when the connecting role has BYPASSRLS, so row-level security would
 * not apply to it. Used by every enforceRls entry point, so the check does not
 * depend on migration 001 running.
 */
export async function assertRoleSubjectToRls(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{ role: string; bypass: boolean }>(
    "SELECT current_user AS role, rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user",
  );
  if (rows[0]?.bypass) {
    throw new Error(
      `SECURITY: Application role "${rows[0].role}" has BYPASSRLS privilege. ` +
        "Connect as a dedicated role without BYPASSRLS, or turn enforceRls off for development.",
    );
  }
}

export async function migrate(options: MigrateOptions): Promise<void> {
  const { pool, enforceRls, controlRole, applyControlRole } = options;
  if (controlRole !== undefined) assertRoleName(controlRole, "control role");

  if (enforceRls) {
    await assertRoleSubjectToRls(pool);
  }

  // The migrations create their objects in the first schema of the search
  // path; the tracking table lives there too, named with that schema.
  const current = await pool.query<{ schema: string | null }>("SELECT pg_catalog.current_schema() AS schema");
  const schema = current.rows[0]?.schema;
  if (!schema) {
    throw new Error("[stratum] migrate: no schema on the search path of the migrating login to create the Stratum tables in");
  }
  const migrationsTable = `${quoteIdentifier(schema)}._migrations`;

  // Create migrations tracking table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${migrationsTable} (
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

  // Migrations 029 and 031 created helper functions with `SET app.*` clauses,
  // which PostgreSQL accepts only from a superuser (or a role granted SET on
  // the parameter). For any other migrating role, migrationSql() drops those
  // clause lines from these two files only; migration 032 then re-creates
  // both functions without them when it applies the control role. Until it
  // does, they see only what their caller sees, which can only narrow what
  // they return. See migration-sql.ts.
  const superuser = await isSuperuser(pool);

  for (const file of files) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Acquire advisory lock to prevent concurrent migrations
      await client.query("SELECT pg_advisory_xact_lock(8675309)");

      // Re-check if already applied (after lock, to prevent TOCTOU race)
      const { rows } = await client.query(
        `SELECT 1 FROM ${migrationsTable} WHERE name = $1`,
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
      await setApplyControlRole(client, applyControlRole);

      const sql = migrationSql(file, fs.readFileSync(path.join(migrationsDir, file), "utf-8"), superuser);
      await client.query(sql);
      await client.query(`INSERT INTO ${migrationsTable} (name) VALUES ($1)`, [file]);
      await client.query("COMMIT");
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch { /* ignore rollback failure */ }
      throw err;
    } finally {
      client.release();
    }
  }
}
