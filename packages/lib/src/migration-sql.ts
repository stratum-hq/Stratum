import type pg from "pg";

/** The default name of the NOLOGIN control role (migration 032). */
export const STRATUM_CONTROL_ROLE = "stratum_control";

/** A role name Stratum accepts: a plain lowercase identifier. */
export const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

/** Throws when `role` is not a plain lowercase identifier. */
export function assertRoleName(role: string, what: string): void {
  if (!ROLE_NAME.test(role)) {
    throw new Error(`[stratum] Invalid ${what} '${role}': use lowercase letters, digits and underscores`);
  }
}

// Migrations 029 and 031 created their helper functions with
// `SET app.bypass_rls = 'on'` (and `SET app.tenant_scope = ''`) clauses.
// PostgreSQL lets only a superuser, or a role granted SET on the parameter,
// put a custom setting in a function, so a fresh install by a role that is
// not a superuser stopped at 029. For such a role the runner drops the
// clauses from these two files. Migration 032 re-creates both functions
// without them (SECURITY DEFINER, owned by the control role) when it applies
// the control role, in the same run or later through
// stratum_apply_control_role(). Until then the functions see what their
// caller sees, which can only narrow what they return. A superuser runs the
// files as they are.
const SUPERSEDED_SET_CLAUSES = new Set(["029_tenant_parent_cycle_guard.sql", "031_subtree_read_scope.sql"]);
const APP_SET_CLAUSE = /^SET app\.[a-z_]+ = '[^']*'\n/gm;

/** The SQL to run for one migration file. */
export function migrationSql(name: string, sql: string, superuser: boolean): string {
  if (superuser || !SUPERSEDED_SET_CLAUSES.has(name)) return sql;
  return sql.replace(APP_SET_CLAUSE, "");
}

/** Whether the role of `client` is a superuser. */
export async function isSuperuser(client: pg.PoolClient | pg.Pool): Promise<boolean> {
  const res = await client.query<{ rolsuper: boolean }>(
    "SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user",
  );
  return res.rows[0]?.rolsuper === true;
}

/**
 * Sets stratum.control_role for the current transaction, which migration 032
 * reads. Without a name the setting stays as the session has it.
 */
export async function setControlRole(client: pg.PoolClient, controlRole: string | undefined): Promise<void> {
  if (controlRole === undefined) return;
  await client.query("SELECT pg_catalog.set_config('stratum.control_role', $1, true)", [controlRole]);
}

/**
 * Sets stratum.apply_control_role = 'on' for the current transaction when
 * `apply` is true. Migration 032 grants the control role to the migrating
 * login only with this opt-in (or when the login is a superuser or already a
 * member), because that login must be the library's admin login and never
 * the application's.
 */
export async function setApplyControlRole(client: pg.PoolClient, apply: boolean | undefined): Promise<void> {
  if (!apply) return;
  await client.query("SELECT pg_catalog.set_config('stratum.apply_control_role', 'on', true)");
}
