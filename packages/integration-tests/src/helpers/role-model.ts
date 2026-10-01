import pg from "pg";

/**
 * Helpers for the tests of the control-role model (migration 032).
 *
 * Roles are cluster-wide, so every role these tests create carries a prefix
 * (STRATUM_IT_ROLE_PREFIX, default "stratum_it_"), and each test file drops
 * the roles it created. The control role comes from the setting
 * stratum.control_role when the connection sets it (for example through
 * PGOPTIONS), and is stratum_control otherwise, the same default migration
 * 032 uses.
 */

export const BASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://stratum_test:stratum_test@localhost:5433/stratum_test";

export const ROLE_PREFIX = process.env.STRATUM_IT_ROLE_PREFIX || "stratum_it_";

/** The base database URL with another user, password or database. */
export function urlFor(opts: { user?: string; password?: string; database?: string }): string {
  const u = new URL(BASE_URL);
  if (opts.user !== undefined) u.username = opts.user;
  if (opts.password !== undefined) u.password = opts.password;
  if (opts.database !== undefined) u.pathname = `/${opts.database}`;
  return u.toString();
}

/** The name of a scratch database derived from the base database. */
export function scratchDatabase(suffix: string): string {
  return `${new URL(BASE_URL).pathname.slice(1)}_${suffix}`;
}

/** The control role the migrations of this test run use. */
export async function controlRoleName(client: pg.Client | pg.Pool): Promise<string> {
  const res = await client.query<{ name: string | null }>(
    "SELECT NULLIF(current_setting('stratum.control_role', true), '') AS name",
  );
  return res.rows[0]?.name ?? "stratum_control";
}

/** Drops a login role this test created, with what it owns in the current database. */
export async function dropTestRole(superuser: pg.Client, role: string): Promise<void> {
  const exists = await superuser.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role]);
  if (exists.rows.length === 0) return;
  await superuser.query(`DROP OWNED BY "${role}"`).catch(() => {});
  await superuser.query(`DROP ROLE IF EXISTS "${role}"`);
}

/**
 * The tables the application role may read under the recommended grants:
 * every tenant-scoped Stratum table except the credential-bearing ones
 * (api_keys, webhooks), regions and the stratum_security settings table.
 */
export const APP_READ_TABLES = [
  "tenants",
  "config_entries",
  "permission_policies",
  "audit_logs",
  "webhook_events",
  "webhook_deliveries",
  "consent_records",
  "abac_policies",
  "roles",
  "principal_roles",
  "usage_events",
] as const;

/** Runs `fn` in a transaction that is always rolled back. */
export async function inRolledBackTx<T>(
  pool: pg.Pool,
  fn: (c: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    return await fn(c);
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    c.release();
  }
}

/** The SQLSTATE of the error `fn` throws, or "no error". */
export async function errorCode(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "no error";
  } catch (err) {
    return (err as { code?: string }).code ?? String(err);
  }
}
