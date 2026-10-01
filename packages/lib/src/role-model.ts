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
  "stratum_apply_control_role",
];

/**
 * The md5 of the body (pg_proc.prosrc) of each Stratum function that
 * stratum_apply_control_role() does not re-create, as the migrations define
 * it last. A unit test derives them from the migration files.
 */
export const STRATUM_FUNCTION_BODY_MD5: Readonly<Record<string, string>> = Object.freeze({
  update_updated_at_column: "301a884953d37769916294bb60562e05",
  maintain_ancestry_ltree: "ddce857b77ffe5dad27239825949c886",
  propagate_ancestry_ltree: "a79bc2cb286893cb622c336876491759",
  stratum_legacy_bypass: "6fab3a709d5a9c11869f46397042f802",
  stratum_apply_control_role: "374e828b1d7fc9c36412a7ac5fc604cb",
});

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
 * superuser, or a role with CREATEROLE that owns the Stratum tables. It is
 * idempotent.
 *
 * - Creates the NOLOGIN control role when it does not exist, and lets it use
 *   and create objects in the schema (it owns the 032 helpers).
 * - With `adminRole`: makes the admin login a member of the control role
 *   (WITH INHERIT TRUE, SET TRUE on PostgreSQL 16 and later), and moves the
 *   Stratum tables and functions that `appRole` owns to it.
 * - Applies the control role to the Stratum objects through
 *   stratum_apply_control_role() of migration 032, when it exists. This is
 *   what activates the hardening when the migration could not (its migrating
 *   role could neither create nor join the control role). It needs a
 *   superuser or the owner of the Stratum tables.
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
    `-- Stratum role model (migration 032). Run as a superuser, or a role with CREATEROLE that owns the Stratum tables.`,
    integrityCheckSql(schema),
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

  parts.push(
    `-- Apply the control role to the Stratum objects (migration 032), when they exist.
DO $$ BEGIN
  IF to_regprocedure('${quote(schema)}.stratum_apply_control_role(text, text)') IS NOT NULL THEN
    PERFORM ${quote(schema)}.stratum_apply_control_role(${literal(control)}, ${literal(schema)});
  END IF;
END $$;`,
  );

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
 * A DO block that stops the bootstrap when the Stratum tables carry code that
 * the migrations did not put there. Whoever owned the tables before (often
 * the application login) could have attached it, and it would run with the
 * rights of whoever writes to the tables later: the admin login, or the
 * superuser that runs this SQL. It checks, in `schema`:
 *
 * - every Stratum relation is a table;
 * - no rule is attached to a Stratum table;
 * - every trigger calls a Stratum function;
 * - policies, column defaults, constraints, triggers and indexes of the
 *   Stratum tables call only functions and operators of pg_catalog, of an
 *   extension, or of Stratum;
 * - every column has a type of pg_catalog or of an extension;
 * - the Stratum functions that stratum_apply_control_role() does not
 *   re-create have the bodies the migrations give them, and
 *   stratum_apply_control_role() itself, which this SQL runs, is SECURITY
 *   INVOKER with its pinned search_path.
 */
function integrityCheckSql(schema: string): string {
  const bodies = Object.entries(STRATUM_FUNCTION_BODY_MD5)
    .map(([name, md5]) => `(${literal(name)}, ${literal(md5)})`)
    .join(", ");
  return `-- Refuse to continue when the Stratum tables carry code the migrations did not put there.
DO $$
DECLARE
  v_ns oid := to_regnamespace(${literal(quote(schema))});
  v_tables text[] := ${sqlArray(STRATUM_TABLES)};
  v_functions text[] := ${sqlArray(STRATUM_FUNCTIONS)};
  v_pin text := format('search_path=pg_catalog, %I, pg_temp', ${literal(schema)});
  v_problems text[] := '{}';
  r record;
BEGIN
  IF v_ns IS NULL THEN
    RETURN;
  END IF;
  FOR r IN
    SELECT c.relname, c.relkind FROM pg_class c
     WHERE c.relnamespace = v_ns AND c.relname = ANY (v_tables) AND c.relkind NOT IN ('r', 'p')
  LOOP
    v_problems := v_problems || format('%I is not a table (relkind %s)', r.relname, r.relkind);
  END LOOP;
  FOR r IN
    SELECT c.relname, w.rulename FROM pg_rewrite w JOIN pg_class c ON c.oid = w.ev_class
     WHERE c.relnamespace = v_ns AND c.relname = ANY (v_tables)
  LOOP
    v_problems := v_problems || format('rule %I on %I', r.rulename, r.relname);
  END LOOP;
  FOR r IN
    SELECT c.relname, t.tgname, t.tgfoid::regprocedure::text AS fn FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid
     WHERE NOT t.tgisinternal AND c.relnamespace = v_ns AND c.relname = ANY (v_tables)
       AND NOT (p.pronamespace = v_ns AND p.proname = ANY (v_functions))
  LOOP
    v_problems := v_problems || format('trigger %I on %I calls %s', r.tgname, r.relname, r.fn);
  END LOOP;
  FOR r IN
    WITH t AS (
      SELECT c.oid, c.relname FROM pg_class c WHERE c.relnamespace = v_ns AND c.relname = ANY (v_tables)
    ), o AS (
      SELECT 'pg_policy'::regclass AS classid, x.oid AS objid, t.relname, 'policy ' || quote_ident(x.polname) AS what
        FROM pg_policy x JOIN t ON t.oid = x.polrelid
      UNION ALL
      SELECT 'pg_attrdef'::regclass, x.oid, t.relname, 'column default' FROM pg_attrdef x JOIN t ON t.oid = x.adrelid
      UNION ALL
      SELECT 'pg_constraint'::regclass, x.oid, t.relname, 'constraint ' || quote_ident(x.conname)
        FROM pg_constraint x JOIN t ON t.oid = x.conrelid
      UNION ALL
      SELECT 'pg_trigger'::regclass, x.oid, t.relname, 'trigger ' || quote_ident(x.tgname)
        FROM pg_trigger x JOIN t ON t.oid = x.tgrelid WHERE NOT x.tgisinternal
      UNION ALL
      SELECT 'pg_class'::regclass, x.indexrelid, t.relname, 'index ' || quote_ident(x.indexrelid::regclass::text)
        FROM pg_index x JOIN t ON t.oid = x.indrelid
    )
    SELECT DISTINCT o.relname, o.what,
           CASE WHEN d.refclassid = 'pg_proc'::regclass THEN 'function ' || d.refobjid::regprocedure::text
                ELSE 'operator ' || d.refobjid::regoperator::text END AS ref
      FROM o JOIN pg_depend d ON d.classid = o.classid AND d.objid = o.objid
      LEFT JOIN pg_proc p ON d.refclassid = 'pg_proc'::regclass AND p.oid = d.refobjid
      LEFT JOIN pg_operator op ON d.refclassid = 'pg_operator'::regclass AND op.oid = d.refobjid
     WHERE d.refclassid IN ('pg_proc'::regclass, 'pg_operator'::regclass)
       AND coalesce(p.pronamespace, op.oprnamespace) <> 'pg_catalog'::regnamespace
       AND NOT EXISTS (SELECT 1 FROM pg_depend e
                        WHERE e.classid = d.refclassid AND e.objid = d.refobjid AND e.deptype = 'e')
       AND NOT (p.pronamespace = v_ns AND p.proname = ANY (v_functions))
  LOOP
    v_problems := v_problems || format('%s on %I uses %s', r.what, r.relname, r.ref);
  END LOOP;
  FOR r IN
    SELECT c.relname, a.attname, a.atttypid::regtype::text AS typ FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid JOIN pg_type ty ON ty.oid = a.atttypid
     WHERE c.relnamespace = v_ns AND c.relname = ANY (v_tables) AND a.attnum > 0 AND NOT a.attisdropped
       AND ty.typnamespace <> 'pg_catalog'::regnamespace
       AND NOT EXISTS (SELECT 1 FROM pg_depend e
                        WHERE e.classid = 'pg_type'::regclass AND e.deptype = 'e'
                          AND e.objid IN (ty.oid, ty.typelem))
  LOOP
    v_problems := v_problems || format('column %I.%I has type %s', r.relname, r.attname, r.typ);
  END LOOP;
  FOR r IN
    SELECT f.name, p.oid IS NOT NULL AS present, md5(p.prosrc) = f.md5 AS same_body, p.proconfig, p.prosecdef
      FROM (VALUES ${bodies}) AS f(name, md5)
      LEFT JOIN pg_proc p ON p.pronamespace = v_ns AND p.proname = f.name
  LOOP
    IF r.present AND NOT r.same_body THEN
      v_problems := v_problems || format('function %I has a body the migrations did not give it', r.name);
    ELSIF r.present AND r.proconfig IS NOT NULL AND r.proconfig <> ARRAY[v_pin] THEN
      v_problems := v_problems || format('function %I has settings %s', r.name, r.proconfig::text);
    ELSIF r.present AND r.name = 'stratum_apply_control_role' AND (r.prosecdef OR r.proconfig IS NULL) THEN
      v_problems := v_problems || 'function stratum_apply_control_role is not SECURITY INVOKER with its pinned search_path';
    END IF;
  END LOOP;
  IF cardinality(v_problems) > 0 THEN
    RAISE EXCEPTION E'The Stratum tables in schema % carry objects the Stratum migrations did not create:\n  %\nSuch objects run with the rights of whoever writes to the tables. Remove them (or restore the Stratum functions from the migrations), then run this again.',
      ${literal(schema)}, array_to_string(v_problems, E'\n  ')
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
END $$;`;
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

/**
 * The login whose roles are checked: the login of `pool`, or the role named
 * `role`, read through `pool` (any login that can read the catalog).
 */
interface RoleSubject {
  pool: pg.Pool;
  role?: string;
}

/** Why the admin login cannot act as the control plane. Empty when it can. */
async function adminRoleIssues(subject: RoleSubject, control: string): Promise<string[]> {
  const res = await subject.pool.query<{ me: string; rolsuper: boolean; rolbypassrls: boolean; exists: boolean; usage: boolean | null }>(
    `SELECT r.rolname::text AS me, r.rolsuper, r.rolbypassrls,
            EXISTS (SELECT 1 FROM pg_roles c WHERE c.rolname = $1) AS exists,
            (SELECT pg_has_role(r.oid, c.oid, 'USAGE') FROM pg_roles c WHERE c.rolname = $1) AS usage
       FROM pg_roles r WHERE r.rolname = COALESCE($2::text, current_user)`,
    [control, subject.role ?? null],
  );
  const row = res.rows[0];
  if (!row) return [`the admin role "${subject.role}" does not exist`];
  if (row.rolsuper || row.rolbypassrls || row.usage) return [];
  if (!row.exists) return [`the control role "${control}" does not exist; run the Stratum migrations (032)`];
  return [`the admin role "${row.me}" is not a member of the control role "${control}" with INHERIT`];
}

/** Why the application login is not limited to the application's share. Empty when it is. */
async function appRoleIssues(subject: RoleSubject, control: string): Promise<string[]> {
  const res = await subject.pool.query<{
    me: string;
    rolsuper: boolean;
    rolbypassrls: boolean;
    member: boolean | null;
    owned: string[] | null;
    writable: string[] | null;
    credential_reads: string[] | null;
    owned_functions: string[] | null;
    owned_schema: string | null;
  }>(
    `WITH t AS (
       SELECT c.oid, c.relname, c.relowner FROM pg_class c
        WHERE c.relkind IN ('r', 'p') AND c.relname = ANY ($2::text[])
          AND c.relnamespace = (SELECT relnamespace FROM pg_class WHERE oid = to_regclass('tenants'))
     )
     SELECT r.rolname::text AS me, r.rolsuper, r.rolbypassrls,
            (SELECT pg_has_role(r.oid, c.oid, 'MEMBER') FROM pg_roles c WHERE c.rolname = $1) AS member,
            (SELECT array_agg(t.relname::text ORDER BY t.relname) FROM t
              WHERE pg_has_role(r.oid, t.relowner, 'MEMBER')) AS owned,
            (SELECT array_agg(t.relname::text ORDER BY t.relname) FROM t
              WHERE has_table_privilege(r.oid, t.oid, 'INSERT') OR has_table_privilege(r.oid, t.oid, 'UPDATE')
                 OR has_table_privilege(r.oid, t.oid, 'DELETE') OR has_table_privilege(r.oid, t.oid, 'TRUNCATE')) AS writable,
            (SELECT array_agg(t.relname::text ORDER BY t.relname) FROM t
              WHERE t.relname = ANY ($3::text[]) AND has_table_privilege(r.oid, t.oid, 'SELECT')) AS credential_reads,
            (SELECT array_agg(DISTINCT p.proname::text) FROM pg_proc p
              WHERE pg_has_role(r.oid, p.proowner, 'MEMBER') AND p.proname = ANY ($4::text[])
                AND p.pronamespace = (SELECT relnamespace FROM pg_class WHERE oid = to_regclass('tenants'))) AS owned_functions,
            -- The owner of the schema can drop and re-create any table in it.
            -- On PostgreSQL 15 and later, public belongs to pg_database_owner,
            -- so the owner of the database owns it.
            (SELECT n.nspname::text FROM pg_namespace n
              WHERE n.oid = (SELECT relnamespace FROM pg_class WHERE oid = to_regclass('tenants'))
                AND pg_has_role(r.oid, n.nspowner, 'MEMBER')) AS owned_schema
       FROM pg_roles r WHERE r.rolname = COALESCE($5::text, current_user)`,
    [control, [...STRATUM_TABLES], CREDENTIAL_TABLES, STRATUM_FUNCTIONS, subject.role ?? null],
  );
  const row = res.rows[0];
  if (!row) return subject.role === undefined ? [] : [`the app role "${subject.role}" does not exist`];
  const issues: string[] = [];
  const who = `the app role "${row.me}"`;
  if (row.rolsuper) issues.push(`${who} is a superuser`);
  if (row.rolbypassrls) issues.push(`${who} has BYPASSRLS`);
  if (row.member) issues.push(`${who} is a member of the control role "${control}"`);
  if (!row.rolsuper && row.owned?.length) issues.push(`${who} owns Stratum tables: ${row.owned.join(", ")}`);
  if (!row.rolsuper && row.owned_functions?.length) {
    issues.push(`${who} owns Stratum functions: ${row.owned_functions.join(", ")}`);
  }
  if (!row.rolsuper && row.owned_schema) {
    issues.push(`${who} owns the schema "${row.owned_schema}" of the Stratum tables (directly or as the database owner)`);
  }
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

/**
 * Whether migration 032 ran but the control role is not applied: the
 * stratum_security table exists and no stratum_control_plane policy does.
 */
async function hardeningInactive(pool: pg.Pool): Promise<boolean> {
  const res = await pool.query<{ inactive: boolean }>(
    `SELECT to_regclass('stratum_security') IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'stratum_control_plane') AS inactive`,
  );
  return res.rows[0]?.inactive === true;
}

export interface RoleModelCheckOptions {
  /** The library's admin pool, or undefined in the legacy single-pool mode. */
  adminPool?: pg.Pool;
  appPool: pg.Pool;
  /** The configured control role, or undefined to use the database's. */
  controlRole?: string;
  /** Throw, instead of warn, when the application role is misconfigured. */
  strict: boolean;
  logger: StratumLogger;
}

/**
 * Reports whether the control-role hardening of migration 032 is active and,
 * with an adminPool, checks the admin and application logins against the
 * role model, warning about each problem. With `strict`, a misconfigured
 * application login throws instead.
 */
export async function checkRoleModel(options: RoleModelCheckOptions): Promise<void> {
  const { adminPool, appPool, logger } = options;

  if (await hardeningInactive(adminPool ?? appPool)) {
    logger.warn(
      "Stratum control-role hardening is not active: migration 032 could not apply the control role, " +
        "so this database keeps the pre-1.8 behavior. Run the SQL from bootstrapRolesSql() as a superuser " +
        "(or `stratum db roles`) to activate it.",
    );
    return;
  }
  if (!adminPool) return;

  const control = options.controlRole ?? (await databaseControlRole(adminPool)) ?? STRATUM_CONTROL_ROLE;

  for (const issue of await adminRoleIssues({ pool: adminPool }, control)) {
    logger.warn(`adminPool: ${issue}`, { control_role: control });
  }

  const appIssues = await appRoleIssues({ pool: appPool }, control);
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
        "turn it off with `stratum db lock` (or UPDATE stratum_security SET legacy_guc_bypass = false " +
        "as a member of the control role).",
      { control_role: control },
    );
  }
}

/** What {@link inspectRoleModel} found. */
export interface RoleModelReport {
  /** Whether migration 032 ran (the stratum_security table exists). */
  migrated: boolean;
  /** Whether the control role is applied: stratum_control_plane policies exist. */
  hardeningActive: boolean;
  /** The control role checked against: the option, else the database's, else the default. */
  controlRole: string;
  /** Problems with the admin login, or null when no adminPool was given. */
  adminIssues: string[] | null;
  /** Problems with the application login, or null when no appPool was given. */
  appIssues: string[] | null;
  /**
   * Whether the legacy app.bypass_rls switch is on. Null when it cannot be
   * read: before 032, without an adminPool, or when the admin login cannot
   * see the stratum_security row.
   */
  legacyBypass: boolean | null;
}

export interface InspectRoleModelOptions {
  /** A pool that logs in as the application login, which is checked. */
  appPool?: pg.Pool;
  /** A pool that logs in as the admin login, which is checked. */
  adminPool?: pg.Pool;
  /**
   * A pool to read the catalog through when the logins are given by name
   * (`appRole`, `adminRole`), for example a superuser's.
   */
  pool?: pg.Pool;
  /** Check this application role by name, through `pool`, instead of the login of `appPool`. */
  appRole?: string;
  /** Check this admin role by name, through `pool`, instead of the login of `adminPool`. */
  adminRole?: string;
  /** The control role. Default: the database's, else `stratum_control`. */
  controlRole?: string;
}

/**
 * Checks the logins of a database against the role model of migration 032,
 * without logging or throwing. `stratum health`, `stratum doctor` and
 * `stratum db roles` use it; Stratum.initialize() applies the same checks.
 */
export async function inspectRoleModel(options: InspectRoleModelOptions): Promise<RoleModelReport> {
  const { appPool, adminPool } = options;
  const pool = options.pool ?? adminPool ?? appPool;
  if (!pool) throw new Error("[stratum] inspectRoleModel needs pool, appPool or adminPool");
  if (options.controlRole !== undefined) assertRoleName(options.controlRole, "control role");
  const appSubject: RoleSubject | undefined =
    options.appRole !== undefined ? { pool, role: options.appRole } : appPool ? { pool: appPool } : undefined;
  const adminSubject: RoleSubject | undefined =
    options.adminRole !== undefined ? { pool, role: options.adminRole } : adminPool ? { pool: adminPool } : undefined;
  const switchReader = adminPool ?? options.pool;

  const present = await pool.query<{ migrated: boolean; active: boolean }>(
    `SELECT to_regclass('stratum_security') IS NOT NULL AS migrated,
            EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'stratum_control_plane') AS active`,
  );
  const migrated = present.rows[0]?.migrated === true;
  const hardeningActive = present.rows[0]?.active === true;
  const control = options.controlRole ?? (await databaseControlRole(pool)) ?? STRATUM_CONTROL_ROLE;

  return {
    migrated,
    hardeningActive,
    controlRole: control,
    adminIssues: adminSubject ? await adminRoleIssues(adminSubject, control) : null,
    appIssues: appSubject ? await appRoleIssues(appSubject, control) : null,
    legacyBypass: switchReader && migrated ? await legacyBypassOn(switchReader) : null,
  };
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

let warnedLegacyKeyHash = false;

/** Warns once per process that an API key with a legacy SHA-256 hash authenticated. */
export function warnLegacyKeyHash(logger: StratumLogger): void {
  if (warnedLegacyKeyHash) return;
  warnedLegacyKeyHash = true;
  logger.warn(
    "An API key with a legacy SHA-256 hash (version 1) authenticated while STRATUM_API_KEY_HMAC_SECRET is set; " +
      "it was re-hashed with HMAC. 2.0 will refuse such keys: rotate the ones that are not used before then, " +
      "or set allowLegacyKeyHashes: false to refuse them now.",
  );
}

