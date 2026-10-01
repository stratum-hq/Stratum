import type pg from "pg";
import type { StratumLogger } from "./logger.js";
import { STRATUM_TABLES } from "./stratum-tables.js";
import { STRATUM_CONTROL_ROLE, assertRoleName } from "./migration-sql.js";

/**
 * The role model of migration 032.
 *
 * - The control role (default stratum_control) is NOLOGIN. Every Stratum
 *   table has a stratum_control_plane policy for it, and it owns the
 *   SECURITY DEFINER helpers.
 * - The admin login backs the library's adminPool. It is a member of the
 *   control role (INHERIT), owns the Stratum objects and runs the migrations.
 *   It needs neither SUPERUSER nor BYPASSRLS.
 * - The application login is not a member of the control role, owns nothing
 *   of Stratum's, and may read only the tables in APP_READ_TABLES.
 */

/** The Stratum tables the application role may read; it may write none. */
export const APP_READ_TABLES: readonly string[] = Object.freeze([
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
]);

/** Tables whose rows hold credentials or infrastructure; the application role reads none of them. */
const CREDENTIAL_TABLES = ["api_keys", "webhooks", "regions", "stratum_security"];

/** Functions of the Stratum migrations, which the application role must not own. */
const STRATUM_FUNCTIONS = [
  "update_updated_at_column",
  "maintain_ancestry_ltree",
  "propagate_ancestry_ltree",
  "refuse_tenant_parent_cycle",
  "refuse_tenant_tree_column_change",
  "stratum_subtree_tenant_ids",
  "stratum_legacy_bypass",
];

export interface BootstrapRolesOptions {
  /** The admin login to make a member of the control role. Omit to skip that grant. */
  adminRole?: string;
  /** The application login to limit to the recommended grants. Omit to skip that section. */
  appRole?: string;
  /** The control role. Default `stratum_control`. */
  controlRole?: string;
  /** The schema of the Stratum tables. Default `public`. */
  schema?: string;
}

function quote(name: string): string {
  return `"${name}"`;
}

function literal(name: string): string {
  return `'${name}'`;
}

function sqlArray(names: readonly string[]): string {
  return `ARRAY[${names.map(literal).join(", ")}]`;
}

/**
 * The SQL a database administrator runs to set up the role model, as a
 * superuser or a role with CREATEROLE. It is idempotent.
 *
 * - Creates the NOLOGIN control role when it does not exist, and lets it use
 *   and create objects in the schema (it owns the 032 helpers).
 * - With `adminRole`: makes the admin login a member of the control role
 *   (WITH INHERIT TRUE, SET TRUE on PostgreSQL 16 and later), and moves the
 *   Stratum tables and functions that `appRole` owns to it.
 * - With `appRole`: removes the application login from the control role,
 *   revokes its privileges on every Stratum table, and grants it SELECT on
 *   the read-list tables only. This part acts on the tables that exist, so
 *   run it again after a migration that adds a table.
 *
 * The login roles themselves, with their passwords, are yours to create.
 *
 * @throws Error when a name is not a plain lowercase identifier.
 */
export function bootstrapRolesSql(options: BootstrapRolesOptions = {}): string {
  const control = options.controlRole ?? STRATUM_CONTROL_ROLE;
  const schema = options.schema ?? "public";
  assertRoleName(control, "control role");
  assertRoleName(schema, "schema");
  if (options.adminRole !== undefined) assertRoleName(options.adminRole, "admin role");
  if (options.appRole !== undefined) assertRoleName(options.appRole, "app role");

  const parts: string[] = [
    `-- Stratum role model (migration 032). Run as a superuser or a role with CREATEROLE.`,
    `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${literal(control)}) THEN
    CREATE ROLE ${quote(control)} NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;`,
    `GRANT USAGE, CREATE ON SCHEMA ${quote(schema)} TO ${quote(control)};`,
  ];

  if (options.adminRole !== undefined) {
    const admin = options.adminRole;
    parts.push(
      `-- The admin login (adminPool) is a member of the control role.
DO $$ BEGIN
  IF current_setting('server_version_num')::int >= 160000 THEN
    EXECUTE 'GRANT ${quote(control)} TO ${quote(admin)} WITH INHERIT TRUE, SET TRUE';
  ELSE
    EXECUTE 'GRANT ${quote(control)} TO ${quote(admin)}';
  END IF;
END $$;`,
    );
    if (options.appRole !== undefined) {
      const app = options.appRole;
      parts.push(
        `-- The admin login owns the Stratum objects the application login owned.
DO $$ DECLARE r record; BEGIN
  FOR r IN
    SELECT c.relname FROM pg_class c
     WHERE c.relnamespace = ${literal(schema)}::regnamespace AND c.relkind IN ('r', 'p')
       AND c.relname = ANY (${sqlArray(STRATUM_TABLES)})
       AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = ${literal(app)})
  LOOP
    EXECUTE format('ALTER TABLE %I.%I OWNER TO %I', ${literal(schema)}, r.relname, ${literal(admin)});
  END LOOP;
  FOR r IN
    SELECT p.oid::regprocedure AS fn FROM pg_proc p
     WHERE p.pronamespace = ${literal(schema)}::regnamespace
       AND p.proname = ANY (${sqlArray(STRATUM_FUNCTIONS)})
       AND p.proowner = (SELECT oid FROM pg_roles WHERE rolname = ${literal(app)})
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO %I', r.fn, ${literal(admin)});
  END LOOP;
END $$;`,
      );
    }
  }

  if (options.appRole !== undefined) {
    const app = options.appRole;
    parts.push(
      `-- The application login: not a member of the control role, SELECT on the read list only.
DO $$ DECLARE t text; BEGIN
  IF EXISTS (SELECT 1 FROM pg_auth_members m
              WHERE m.roleid = (SELECT oid FROM pg_roles WHERE rolname = ${literal(control)})
                AND m.member = (SELECT oid FROM pg_roles WHERE rolname = ${literal(app)})) THEN
    EXECUTE 'REVOKE ${quote(control)} FROM ${quote(app)}';
  END IF;
  FOREACH t IN ARRAY ${sqlArray(STRATUM_TABLES)} LOOP
    IF to_regclass(format('%I.%I', ${literal(schema)}, t)) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON %I.%I FROM %I', ${literal(schema)}, t, ${literal(app)});
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ${sqlArray(APP_READ_TABLES)} LOOP
    IF to_regclass(format('%I.%I', ${literal(schema)}, t)) IS NOT NULL THEN
      EXECUTE format('GRANT SELECT ON %I.%I TO %I', ${literal(schema)}, t, ${literal(app)});
    END IF;
  END LOOP;
END $$;`,
      `GRANT USAGE ON SCHEMA ${quote(schema)} TO ${quote(app)};`,
    );
  }

  return `${parts.join("\n")}\n`;
}

/**
 * The control role the database uses: the role of its stratum_control_plane
 * policies, or null before migration 032.
 */
async function databaseControlRole(pool: pg.Pool): Promise<string | null> {
  const res = await pool.query<{ role: string }>(
    `SELECT DISTINCT r::text AS role FROM pg_policies p, unnest(p.roles) r
      WHERE p.policyname = 'stratum_control_plane'`,
  );
  return res.rows.length === 1 ? res.rows[0].role : null;
}

/** Why the admin login cannot act as the control plane. Empty when it can. */
async function adminRoleIssues(pool: pg.Pool, control: string): Promise<string[]> {
  const res = await pool.query<{ me: string; rolsuper: boolean; rolbypassrls: boolean; exists: boolean; usage: boolean | null }>(
    `SELECT current_user AS me, r.rolsuper, r.rolbypassrls,
            EXISTS (SELECT 1 FROM pg_roles c WHERE c.rolname = $1) AS exists,
            (SELECT pg_has_role(current_user, c.oid, 'USAGE') FROM pg_roles c WHERE c.rolname = $1) AS usage
       FROM pg_roles r WHERE r.rolname = current_user`,
    [control],
  );
  const row = res.rows[0];
  if (!row || row.rolsuper || row.rolbypassrls || row.usage) return [];
  if (!row.exists) return [`the control role "${control}" does not exist; run the Stratum migrations (032)`];
  return [`the admin role "${row.me}" is not a member of the control role "${control}" with INHERIT`];
}

/** Why the application login is not limited to the application's share. Empty when it is. */
async function appRoleIssues(pool: pg.Pool, control: string): Promise<string[]> {
  const res = await pool.query<{
    me: string;
    rolsuper: boolean;
    rolbypassrls: boolean;
    member: boolean | null;
    owned: string[] | null;
    writable: string[] | null;
    credential_reads: string[] | null;
    owned_functions: string[] | null;
  }>(
    `WITH t AS (
       SELECT c.oid, c.relname, c.relowner FROM pg_class c
        WHERE c.relkind IN ('r', 'p') AND c.relname = ANY ($2::text[])
          AND c.relnamespace = (SELECT relnamespace FROM pg_class WHERE oid = to_regclass('tenants'))
     )
     SELECT current_user AS me, r.rolsuper, r.rolbypassrls,
            (SELECT pg_has_role(current_user, c.oid, 'MEMBER') FROM pg_roles c WHERE c.rolname = $1) AS member,
            (SELECT array_agg(t.relname::text ORDER BY t.relname) FROM t WHERE t.relowner = r.oid) AS owned,
            (SELECT array_agg(t.relname::text ORDER BY t.relname) FROM t
              WHERE has_table_privilege(t.oid, 'INSERT') OR has_table_privilege(t.oid, 'UPDATE')
                 OR has_table_privilege(t.oid, 'DELETE') OR has_table_privilege(t.oid, 'TRUNCATE')) AS writable,
            (SELECT array_agg(t.relname::text ORDER BY t.relname) FROM t
              WHERE t.relname = ANY ($3::text[]) AND has_table_privilege(t.oid, 'SELECT')) AS credential_reads,
            (SELECT array_agg(DISTINCT p.proname::text) FROM pg_proc p
              WHERE p.proowner = r.oid AND p.proname = ANY ($4::text[])
                AND p.pronamespace = (SELECT relnamespace FROM pg_class WHERE oid = to_regclass('tenants'))) AS owned_functions
       FROM pg_roles r WHERE r.rolname = current_user`,
    [control, [...STRATUM_TABLES], CREDENTIAL_TABLES, STRATUM_FUNCTIONS],
  );
  const row = res.rows[0];
  if (!row) return [];
  const issues: string[] = [];
  const who = `the app role "${row.me}"`;
  if (row.rolsuper) issues.push(`${who} is a superuser`);
  if (row.rolbypassrls) issues.push(`${who} has BYPASSRLS`);
  if (row.member) issues.push(`${who} is a member of the control role "${control}"`);
  if (row.owned?.length) issues.push(`${who} owns Stratum tables: ${row.owned.join(", ")}`);
  if (row.owned_functions?.length) issues.push(`${who} owns Stratum functions: ${row.owned_functions.join(", ")}`);
  if (!row.rolsuper && row.writable?.length) issues.push(`${who} can write Stratum tables: ${row.writable.join(", ")}`);
  if (!row.rolsuper && row.credential_reads?.length) {
    issues.push(`${who} can read credential tables: ${row.credential_reads.join(", ")}`);
  }
  return issues;
}

/** Whether the legacy app.bypass_rls switch of migration 032 is on, or null without 032. */
async function legacyBypassOn(adminPool: pg.Pool): Promise<boolean | null> {
  const present = await adminPool.query<{ present: boolean }>(
    "SELECT to_regclass('stratum_security') IS NOT NULL AS present",
  );
  if (!present.rows[0]?.present) return null;
  const res = await adminPool.query<{ on: boolean }>("SELECT legacy_guc_bypass AS on FROM stratum_security LIMIT 1");
  return res.rows[0]?.on ?? null;
}

export interface RoleModelCheckOptions {
  adminPool: pg.Pool;
  appPool: pg.Pool;
  /** The configured control role, or undefined to use the database's. */
  controlRole?: string;
  /** Throw, instead of warn, when the application role is misconfigured. */
  strict: boolean;
  logger: StratumLogger;
}

/**
 * Checks the admin and application logins against the role model and warns
 * about each problem. With `strict`, a misconfigured application login
 * throws instead.
 */
export async function checkRoleModel(options: RoleModelCheckOptions): Promise<void> {
  const { adminPool, appPool, logger } = options;
  const control = options.controlRole ?? (await databaseControlRole(adminPool)) ?? STRATUM_CONTROL_ROLE;

  for (const issue of await adminRoleIssues(adminPool, control)) {
    logger.warn(`adminPool: ${issue}`, { control_role: control });
  }

  const appIssues = await appRoleIssues(appPool, control);
  if (appIssues.length > 0) {
    const message =
      `[stratum] pool: ${appIssues.join("; ")}. The application role should be limited to SELECT on ` +
      `the Stratum read-list tables; bootstrapRolesSql() prints the grants.`;
    if (options.strict) throw new Error(message);
    logger.warn(message, { control_role: control });
  }

  if ((await legacyBypassOn(adminPool)) === true) {
    logger.warn(
      "The legacy app.bypass_rls switch is on. Once every client of this database uses adminPool, " +
        "turn it off: UPDATE stratum_security SET legacy_guc_bypass = false (as a member of the control role).",
      { control_role: control },
    );
  }
}

let warnedNoAdminPool = false;

/** Warns once per process that Stratum runs without an adminPool. */
export function warnNoAdminPool(logger: StratumLogger): void {
  if (warnedNoAdminPool) return;
  warnedNoAdminPool = true;
  logger.warn(
    "Stratum was created without adminPool, so the library uses the legacy app.bypass_rls path. " +
      "Pass adminPool, a login that is a member of the control role, and keep pool for the application role. " +
      "adminPool becomes required in 2.0.",
  );
}
