import pg from "pg";
import { STRATUM_TABLES } from "@stratum-hq/lib";
import { evaluatePolicies, type PolicyRow } from "./policy-check.js";

export function getConnectionString(flags: Record<string, string | boolean>): string {
  const explicit = flags["database-url"] || flags["d"];
  if (typeof explicit === "string") return explicit;

  const env = process.env.DATABASE_URL;
  if (env) return env;

  return "postgres://stratum_app:stratum_dev@localhost:5432/stratum";
}

export async function connectDb(flags: Record<string, string | boolean>): Promise<pg.Pool> {
  const connectionString = getConnectionString(flags);
  const pool = new pg.Pool({ connectionString, max: 3 });

  // Test connection
  const client = await pool.connect();
  client.release();

  return pool;
}

/** Quote a SQL identifier (table, index or policy name) for use in generated SQL. */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Run `fn` in a transaction with `app.bypass_rls` set for that transaction
 * only. Stratum's own tables (tenants, api_keys, ...) have FORCE RLS whose
 * policies admit rows only under a tenant context or this bypass, so an
 * administrative command that reads or writes them across tenants needs it.
 */
export async function withRlsBypass<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.bypass_rls', 'on', true)");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export interface TableInfo {
  table_name: string;
  has_tenant_id: boolean;
  rls_enabled: boolean;
  rls_forced: boolean;
  /** True when the table's policies restrict rows to the current tenant. */
  has_policy: boolean;
  /**
   * Why the table's existing policies do not isolate it by tenant, or null.
   * When set, a new tenant_isolation policy would not fix the table: an
   * existing permissive policy has to be corrected or dropped by hand.
   */
  policy_issue?: string | null;
}

/**
 * Returns the application tables in the `public` schema with their isolation state.
 * Stratum's own tables are left out: Stratum manages their isolation, and some
 * of them have no `tenant_id` column by design. The list comes from
 * `@stratum-hq/lib`, so it follows the migrations that lib ships.
 */
export async function scanTables(pool: pg.Pool): Promise<TableInfo[]> {
  const result = await pool.query(`
    SELECT
      t.tablename AS table_name,
      EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name = t.tablename
          AND c.column_name = 'tenant_id'
      ) AS has_tenant_id,
      COALESCE(pc.relrowsecurity, false) AS rls_enabled,
      COALESCE(pc.relforcerowsecurity, false) AS rls_forced,
      COALESCE((
        SELECT json_agg(json_build_object(
          'policyname', p.policyname,
          'permissive', p.permissive,
          'cmd', p.cmd,
          'qual', p.qual,
          'with_check', p.with_check
        ))
        FROM pg_policies p
        WHERE p.tablename = t.tablename
          AND p.schemaname = 'public'
      ), '[]'::json) AS policies
    FROM pg_tables t
    JOIN pg_class pc ON pc.relname = t.tablename AND pc.relnamespace = 'public'::regnamespace
    WHERE t.schemaname = 'public'
      AND NOT (t.tablename = ANY($1::text[]))
      AND t.tablename NOT LIKE 'pg_%'
      -- The doubled backslash matters: this is a JS template literal, so a single
      -- backslash is swallowed and Postgres would see a bare underscore, which is
      -- the LIKE single-char wildcard and would exclude every table. Doubling it
      -- sends an escaped underscore so only literal-underscore names are skipped.
      AND t.tablename NOT LIKE '\\_%'
    ORDER BY t.tablename;
  `, [STRATUM_TABLES]);

  // A policy counts only for what its expression does, not for its name.
  return result.rows.map((row: Omit<TableInfo, "has_policy" | "policy_issue"> & { policies: PolicyRow[] }) => {
    const { policies, ...rest } = row;
    const verdict = evaluatePolicies(policies);
    return { ...rest, has_policy: verdict.isolated, policy_issue: verdict.issue };
  });
}

export async function checkExtensions(pool: pg.Pool): Promise<{ uuid_ossp: boolean; ltree: boolean }> {
  const result = await pool.query(`
    SELECT extname FROM pg_extension
    WHERE extname IN ('uuid-ossp', 'ltree');
  `);
  const names = result.rows.map((r: { extname: string }) => r.extname);
  return {
    uuid_ossp: names.includes("uuid-ossp"),
    ltree: names.includes("ltree"),
  };
}

export async function checkBypassRLS(pool: pg.Pool): Promise<boolean> {
  const result = await pool.query(`
    SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user;
  `);
  return result.rows[0]?.rolbypassrls === true;
}

export async function checkStratumTables(pool: pg.Pool): Promise<boolean> {
  const result = await pool.query(`
    SELECT COUNT(*) AS cnt FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('tenants', 'config_entries', 'permission_policies', 'api_keys');
  `);
  return parseInt(result.rows[0].cnt, 10) === 4;
}
