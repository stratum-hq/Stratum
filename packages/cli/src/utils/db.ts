import pg from "pg";
import { STRATUM_TABLES } from "@stratum-hq/lib";
import { DEFAULT_CONTROL_ROLE, evaluatePolicies, type PolicyRow } from "./policy-check.js";
import * as log from "./log.js";

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

/**
 * The connection string of the admin login: the `--admin-database-url` flag,
 * else DATABASE_ADMIN_URL, else undefined. The admin login is the one behind
 * the library's adminPool: a member of the control role of migration 032.
 */
export function getAdminConnectionString(flags: Record<string, string | boolean>): string | undefined {
  const explicit = flags["admin-database-url"];
  if (typeof explicit === "string") return explicit;
  return process.env.DATABASE_ADMIN_URL || undefined;
}

/** Connects to the admin login, or returns undefined when none is configured. */
export async function connectAdminDb(flags: Record<string, string | boolean>): Promise<pg.Pool | undefined> {
  const connectionString = getAdminConnectionString(flags);
  if (connectionString === undefined) return undefined;
  const pool = new pg.Pool({ connectionString, max: 3 });
  try {
    const client = await pool.connect();
    client.release();
  } catch (err) {
    await pool.end().catch(() => undefined);
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Admin database connection failed: ${msg}`);
  }
  return pool;
}

const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * The value of a role-name flag such as `--control-role`, or undefined when
 * the flag is absent. Throws when it has no value or is not a plain
 * lowercase identifier, the names Stratum accepts for its roles.
 */
export function roleFlag(flags: Record<string, string | boolean>, name: string): string | undefined {
  const value = flags[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`--${name} needs a value: --${name} <role>`);
  if (!ROLE_NAME.test(value)) {
    throw new Error(`Invalid --${name} "${value}": use lowercase letters, digits and underscores`);
  }
  return value;
}

/**
 * The control role of migration 032 that the policy checks accept: the
 * `--control-role` flag, else the connection's stratum.control_role setting
 * (ALTER DATABASE ... SET), else stratum_control. Returns undefined for the
 * setting and default, which the queries read themselves.
 */
export function controlRoleFlag(flags: Record<string, string | boolean>): string | undefined {
  return roleFlag(flags, "control-role");
}

/** Runs `fn` in a transaction on `pool`. */
async function inTransaction<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
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

/** Runs a function across tenants on Stratum's tables. */
export type CrossTenantRunner = <T>(fn: (client: pg.PoolClient) => Promise<T>) => Promise<T>;

/**
 * Whether `pool`'s login reaches every row of the Stratum tables without the
 * legacy setting: a superuser, a BYPASSRLS login, or a member (with INHERIT)
 * of the role that the stratum_control_plane policy on tenants names, which
 * exists once migration 032 has applied the control role. With
 * `controlRole`, only that role counts.
 */
async function actsAsControlPlane(pool: pg.Pool, controlRole: string | undefined): Promise<boolean> {
  const res = await pool.query<{ ok: boolean }>(
    `WITH ctl AS (
       SELECT r2::text AS role FROM pg_policies p, unnest(p.roles) r2
        WHERE p.schemaname = 'public' AND p.tablename = 'tenants' AND p.policyname = 'stratum_control_plane'
     )
     SELECT r.rolsuper OR r.rolbypassrls OR EXISTS (
              SELECT 1 FROM ctl JOIN pg_roles c ON c.rolname = ctl.role
               WHERE ($1::text IS NULL OR ctl.role = $1::text)
                 AND pg_has_role(current_user, c.oid, 'USAGE')
            ) AS ok
       FROM pg_roles r WHERE r.rolname = current_user`,
    [controlRole ?? null],
  );
  return res.rows[0]?.ok === true;
}

/**
 * Returns how a command reads or writes Stratum's own tables across tenants.
 *
 * The command runs on the admin connection (`--admin-database-url` or
 * DATABASE_ADMIN_URL), else on the database connection, whichever login
 * PostgreSQL admits by its role: a member of the control role, a superuser,
 * or a BYPASSRLS login. It then sets nothing.
 *
 * Otherwise the command falls back to the legacy app.bypass_rls setting, on
 * the admin connection when there is one, else on the database connection,
 * and prints a warning. That path works only while the legacy switch of
 * migration 032 is on; once `stratum db lock` turns it off, the runner
 * throws instead of returning rows the command never saw.
 */
export async function crossTenantRunner(
  pool: pg.Pool,
  adminPool: pg.Pool | undefined,
  controlRole?: string,
): Promise<CrossTenantRunner> {
  for (const candidate of adminPool ? [adminPool, pool] : [pool]) {
    if (await actsAsControlPlane(candidate, controlRole)) {
      return (fn) => inTransaction(candidate, fn);
    }
  }
  log.warn(
    adminPool
      ? "The admin login is not a member of the control role; using the legacy app.bypass_rls path."
      : "No --admin-database-url (DATABASE_ADMIN_URL); using the legacy app.bypass_rls path, which 2.0 removes.",
  );
  return (fn) => withRlsBypass(adminPool ?? pool, fn);
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
    await assertLegacyBypassOpen(client);
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

/**
 * Throws when the session set app.bypass_rls but the legacy switch of
 * migration 032 is off, so the setting admits nothing. Before 032 the
 * setting always works.
 */
async function assertLegacyBypassOpen(client: pg.PoolClient): Promise<void> {
  const res = await client.query<{ open: boolean }>(
    `SELECT CASE WHEN to_regprocedure('public.stratum_legacy_bypass()') IS NULL THEN true
                 ELSE public.stratum_legacy_bypass() END AS open`,
  );
  if (res.rows[0]?.open !== true) {
    throw new Error(
      "The legacy app.bypass_rls path is closed (stratum db lock). " +
        "Pass --admin-database-url or set DATABASE_ADMIN_URL to a member of the control role.",
    );
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
export async function scanTables(pool: pg.Pool, controlRole?: string): Promise<TableInfo[]> {
  const result = await pool.query(`
    SELECT
      t.tablename AS table_name,
      -- The control role of migration 032 (see doctor checkRLSPolicies).
      COALESCE($2::text, NULLIF(current_setting('stratum.control_role', true), '')) AS control_role,
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
          'with_check', p.with_check,
          'roles', p.roles
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
  `, [STRATUM_TABLES, controlRole ?? null]);

  // A policy counts only for what its expression does, not for its name.
  type Row = Omit<TableInfo, "has_policy" | "policy_issue"> & { control_role: string | null; policies: PolicyRow[] };
  return result.rows.map((row: Row) => {
    const { policies, control_role, ...rest } = row;
    const verdict = evaluatePolicies(policies, "public", control_role ?? DEFAULT_CONTROL_ROLE);
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
