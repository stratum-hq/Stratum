import type pg from "pg";
import type { StratumLogger } from "./logger.js";
import { STRATUM_TABLES } from "./stratum-tables.js";
import { STRATUM_CONTROL_ROLE, assertRoleName } from "./migration-sql.js";
import { pinnedQuery, quoteIdentifier, schemaOfTable } from "./pinned-query.js";

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
  stratum_apply_control_role: "78e5309852d1a441403e8d7f743b9446",
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
 * - Revokes CREATE on the schema from PUBLIC, and with `appRole` from the
 *   application login, so that only roles granted CREATE by name can add
 *   objects to the schema of the Stratum tables.
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
    `-- Only pg_catalog is on the search path while it runs; every Stratum object is named with its schema.`,
    `SET search_path = pg_catalog, pg_temp;`,
    integrityCheckSql(schema),
    `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${literal(control)}) THEN
    CREATE ROLE ${quote(control)} NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;`,
    `GRANT USAGE, CREATE ON SCHEMA ${quote(schema)} TO ${quote(control)};`,
    `-- Only roles granted CREATE by name may create objects in the schema of the Stratum tables.
REVOKE CREATE ON SCHEMA ${quote(schema)} FROM PUBLIC;`,
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
      `REVOKE CREATE ON SCHEMA ${quote(schema)} FROM ${quote(app)};`,
    );
  }

  parts.push("RESET search_path;");
  return `${parts.join("\n")}\n`;
}

/**
 * The PL/pgSQL statements of the integrity check: they collect, in
 * v_problems (text[]), the objects of the schema v_ns (oid) that the Stratum
 * migrations did not put there. Whoever owned the Stratum tables before
 * (often the application login) could have attached them, and they would run
 * with the rights of whoever writes to the tables later: the admin login, the
 * migrating role, or a superuser. They check, in that schema:
 *
 * - every Stratum relation (STRATUM_TABLES, _migrations included) is a table;
 * - no rule is attached to one of them;
 * - every trigger calls a Stratum function;
 * - policies, column defaults, constraints, triggers and indexes of them
 *   call only functions and operators of pg_catalog, of an extension, or of
 *   Stratum;
 * - every column has a type of pg_catalog or of an extension;
 * - the schema holds no operator, and no function or aggregate named like a
 *   function of pg_catalog or of an extension, other than those of
 *   extensions and of Stratum. Such an object can be chosen in place of the
 *   built-in one by a query that has the schema on its search path;
 * - the Stratum functions that stratum_apply_control_role() does not
 *   re-create have the bodies the migrations give them, and
 *   stratum_apply_control_role() itself is SECURITY INVOKER with its pinned
 *   search_path.
 *
 * They expect the variables v_ns oid, v_tables text[], v_functions text[],
 * v_problems text[] and r record, and run with search_path = pg_catalog,
 * pg_temp. bootstrapRolesSql() raises when they find anything; migration 032
 * renders the same statements (a unit test keeps them identical) and then
 * warns and leaves the control role unapplied.
 */
export function integrityChecksPlpgsql(): string {
  const bodies = Object.entries(STRATUM_FUNCTION_BODY_MD5)
    .map(([name, md5]) => `(${literal(name)}, ${literal(md5)})`)
    .join(", ");
  return `  v_tables := ${sqlArray(STRATUM_TABLES)};
  v_functions := ${sqlArray(STRATUM_FUNCTIONS)};
  v_problems := '{}';
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
    SELECT p.oid::regprocedure::text AS fn FROM pg_proc p
     WHERE p.pronamespace = v_ns AND NOT (p.proname = ANY (v_functions))
       AND NOT EXISTS (SELECT 1 FROM pg_depend e
                        WHERE e.classid = 'pg_proc'::regclass AND e.objid = p.oid AND e.deptype = 'e')
       AND EXISTS (SELECT 1 FROM pg_proc q
                    WHERE q.proname = p.proname AND q.oid <> p.oid
                      AND (q.pronamespace = 'pg_catalog'::regnamespace
                           OR EXISTS (SELECT 1 FROM pg_depend e
                                       WHERE e.classid = 'pg_proc'::regclass AND e.objid = q.oid AND e.deptype = 'e')))
  LOOP
    v_problems := v_problems || format('function %s in the schema has the name of a built-in or extension function', r.fn);
  END LOOP;
  FOR r IN
    SELECT o.oid::regoperator::text AS op FROM pg_operator o
     WHERE o.oprnamespace = v_ns
       AND NOT EXISTS (SELECT 1 FROM pg_depend e
                        WHERE e.classid = 'pg_operator'::regclass AND e.objid = o.oid AND e.deptype = 'e')
  LOOP
    v_problems := v_problems || format('operator %s in the schema', r.op);
  END LOOP;
  FOR r IN
    SELECT f.name, p.oid IS NOT NULL AS present, md5(p.prosrc) = f.md5 AS same_body, p.proconfig, p.prosecdef
      FROM (VALUES ${bodies}) AS f(name, md5)
      LEFT JOIN pg_proc p ON p.pronamespace = v_ns AND p.proname = f.name
  LOOP
    IF r.present AND NOT r.same_body THEN
      v_problems := v_problems || format('function %I has a body the migrations did not give it', r.name);
    ELSIF r.present AND r.proconfig IS NOT NULL AND r.proconfig <> ARRAY['search_path=pg_catalog, pg_temp'] THEN
      v_problems := v_problems || format('function %I has settings %s', r.name, r.proconfig::text);
    ELSIF r.present AND r.name = 'stratum_apply_control_role' AND (r.prosecdef OR r.proconfig IS NULL) THEN
      v_problems := v_problems || 'function stratum_apply_control_role is not SECURITY INVOKER with its pinned search_path';
    END IF;
  END LOOP;`;
}

/**
 * A DO block that stops the bootstrap when the Stratum tables carry code that
 * the migrations did not put there; see {@link integrityChecksPlpgsql}.
 */
function integrityCheckSql(schema: string): string {
  return `-- Refuse to continue when the Stratum tables carry code the migrations did not put there.
DO $$
DECLARE
  v_ns oid := to_regnamespace(${literal(quote(schema))});
  v_tables text[];
  v_functions text[];
  v_problems text[];
  r record;
BEGIN
  IF v_ns IS NULL THEN
    RETURN;
  END IF;
${integrityChecksPlpgsql()}
  IF cardinality(v_problems) > 0 THEN
    RAISE EXCEPTION E'The Stratum tables in schema % carry objects the Stratum migrations did not create:\n  %\nSuch objects run with the rights of whoever writes to the tables. Remove them (or restore the Stratum functions from the migrations), then run this again.',
      ${literal(schema)}, array_to_string(v_problems, E'\n  ')
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
END $$;`;
}

/*
 * Every catalog query below runs with the search path pinned to pg_catalog
 * (pinnedQuery), because the logins that run them (a superuser, the admin
 * login) must not resolve functions or operators that other roles created in
 * a schema on their search path. Stratum's own tables are named with the
 * schema that schemaOfTable() finds through the caller's search path.
 */

/**
 * The control role the database uses: the role of its stratum_control_plane
 * policies, or null before migration 032.
 */
async function databaseControlRole(pool: pg.Pool): Promise<string | null> {
  const res = await pinnedQuery<{ role: string }>(
    pool,
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
  const res = await pinnedQuery<{ me: string; rolsuper: boolean; rolbypassrls: boolean; exists: boolean; usage: boolean | null }>(
    subject.pool,
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
  const schema = await schemaOfTable(subject.pool);
  const res = await pinnedQuery<{
    me: string;
    rolsuper: boolean;
    rolbypassrls: boolean;
    member: boolean | null;
    owned: string[] | null;
    writable: string[] | null;
    credential_reads: string[] | null;
    owned_functions: string[] | null;
    owned_schema: string | null;
    create_schema: string | null;
  }>(
    subject.pool,
    `WITH s AS (
       SELECT n.oid FROM pg_namespace n WHERE n.nspname = $6::text
     ), t AS (
       SELECT c.oid, c.relname, c.relowner FROM pg_class c
        WHERE c.relkind IN ('r', 'p') AND c.relname = ANY ($2::text[])
          AND c.relnamespace = (SELECT oid FROM s)
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
                AND p.pronamespace = (SELECT oid FROM s)) AS owned_functions,
            -- The owner of the schema can drop and re-create any table in it.
            -- On PostgreSQL 15 and later, public belongs to pg_database_owner,
            -- so the owner of the database owns it.
            (SELECT n.nspname::text FROM pg_namespace n
              WHERE n.oid = (SELECT oid FROM s)
                AND pg_has_role(r.oid, n.nspowner, 'MEMBER')) AS owned_schema,
            -- A role that can create objects in the schema can add functions
            -- and operators that queries with the schema on their path use.
            (SELECT n.nspname::text FROM pg_namespace n
              WHERE n.oid = (SELECT oid FROM s)
                AND has_schema_privilege(r.oid, n.oid, 'CREATE')) AS create_schema
       FROM pg_roles r WHERE r.rolname = COALESCE($5::text, current_user)`,
    [control, [...STRATUM_TABLES], CREDENTIAL_TABLES, STRATUM_FUNCTIONS, subject.role ?? null, schema],
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
  if (!row.rolsuper && !row.owned_schema && row.create_schema) {
    issues.push(`${who} can create objects in the schema "${row.create_schema}" of the Stratum tables`);
  }
  if (!row.rolsuper && row.writable?.length) issues.push(`${who} can write Stratum tables: ${row.writable.join(", ")}`);
  if (!row.rolsuper && row.credential_reads?.length) {
    issues.push(`${who} can read credential tables: ${row.credential_reads.join(", ")}`);
  }
  return issues;
}

/** The search_path of the admin login: the session's for a pool, else the role's default in this database. */
async function adminSearchPath(admin: RoleSubject): Promise<{ me: string; path: string } | null> {
  if (admin.role === undefined) {
    // Unpinned, so it reads the path the admin login's sessions use.
    const res = await admin.pool.query<{ me: string; path: string }>(
      "SELECT current_user::text AS me, pg_catalog.current_setting('search_path') AS path",
    );
    return res.rows[0] ?? null;
  }
  // As PostgreSQL applies them: role in database, role, database, then the default.
  const res = await pinnedQuery<{ me: string; path: string }>(
    admin.pool,
    `WITH cfg AS (
       SELECT s.setrole, s.setdatabase, substr(c, 13) AS path
         FROM pg_db_role_setting s, unnest(s.setconfig) c WHERE c LIKE 'search_path=%'
     )
     SELECT r.rolname::text AS me, COALESCE(
              (SELECT path FROM cfg WHERE setrole = r.oid AND setdatabase = d.oid),
              (SELECT path FROM cfg WHERE setrole = r.oid AND setdatabase = 0),
              (SELECT path FROM cfg WHERE setrole = 0 AND setdatabase = d.oid),
              (SELECT boot_val FROM pg_settings WHERE name = 'search_path')) AS path
       FROM pg_roles r, pg_database d WHERE r.rolname = $1::text AND d.datname = current_database()`,
    [admin.role],
  );
  return res.rows[0] ?? null;
}

/**
 * Why a schema the application login creates could shadow the Stratum schema
 * on the admin login's search path, or null when it cannot: the application
 * login can create schemas in the database and the admin login's path starts
 * from "$user", so a schema named after the admin login would come first.
 */
async function searchPathShadowIssue(app: RoleSubject, admin: RoleSubject): Promise<string | null> {
  const res = await pinnedQuery<{ me: string; su: boolean; can_create: boolean; db: string }>(
    app.pool,
    `SELECT r.rolname::text AS me, r.rolsuper AS su, has_database_privilege(r.oid, d.oid, 'CREATE') AS can_create,
            d.datname::text AS db
       FROM pg_roles r, pg_database d
      WHERE r.rolname = COALESCE($1::text, current_user) AND d.datname = current_database()`,
    [app.role ?? null],
  );
  const row = res.rows[0];
  if (!row || row.su || !row.can_create) return null;
  const adminPath = await adminSearchPath(admin);
  if (!adminPath || !adminPath.path.includes("$user")) return null;
  return (
    `the app role "${row.me}" can create schemas in the database "${row.db}", and the search_path of the admin ` +
    `login "${adminPath.me}" (${adminPath.path}) contains "$user", so a schema named after the admin login would ` +
    `come first on it. Set the admin login's path (ALTER ROLE ${quoteIdentifier(adminPath.me)} IN DATABASE ` +
    `${quoteIdentifier(row.db)} SET search_path = <Stratum schema>) or REVOKE CREATE ON DATABASE ` +
    `${quoteIdentifier(row.db)} FROM ${quoteIdentifier(row.me)}`
  );
}

/** The login of `pool`. */
export async function currentLogin(pool: pg.Pool): Promise<string> {
  const res = await pinnedQuery<{ me: string }>(pool, "SELECT current_user::text AS me");
  return res.rows[0].me;
}

/** Whether the login of `pool` is a member of `control` and not a superuser. */
async function isNonSuperuserMember(pool: pg.Pool, control: string): Promise<boolean> {
  const res = await pinnedQuery<{ member: boolean | null }>(
    pool,
    `SELECT NOT r.rolsuper AND (SELECT pg_has_role(r.oid, c.oid, 'MEMBER') FROM pg_roles c WHERE c.rolname = $1) AS member
       FROM pg_roles r WHERE r.rolname = current_user`,
    [control],
  );
  return res.rows[0]?.member === true;
}

/**
 * The roles, other than superusers, that are members of `control`, directly
 * or through another role, with whether each can log in.
 */
async function controlRoleMembers(pool: pg.Pool, control: string): Promise<{ role: string; login: boolean }[]> {
  const res = await pinnedQuery<{ role: string; login: boolean }>(
    pool,
    `SELECT r.rolname::text AS role, r.rolcanlogin AS login FROM pg_roles r, pg_roles c
      WHERE c.rolname = $1 AND r.oid <> c.oid AND NOT r.rolsuper AND pg_has_role(r.oid, c.oid, 'MEMBER')
      ORDER BY r.rolname`,
    [control],
  );
  return res.rows;
}

/** Whether the legacy app.bypass_rls switch of migration 032 is on, or null without 032. */
async function legacyBypassOn(adminPool: pg.Pool): Promise<boolean | null> {
  const schema = await schemaOfTable(adminPool, "stratum_security");
  if (schema === null) return null;
  const res = await pinnedQuery<{ on: boolean }>(
    adminPool,
    `SELECT legacy_guc_bypass AS on FROM ${quoteIdentifier(schema)}.stratum_security LIMIT 1`,
  );
  return res.rows[0]?.on ?? null;
}

/**
 * Why the login of `pool`, an application login, should not be able to
 * create objects in the schema of the Stratum tables, or null when it cannot
 * (or is a superuser, which the other checks report). The privilege may come
 * from PUBLIC.
 */
async function schemaCreateIssue(pool: pg.Pool): Promise<string | null> {
  const schema = await schemaOfTable(pool);
  if (schema === null) return null;
  const res = await pinnedQuery<{ me: string; su: boolean; login: boolean; everyone: boolean }>(
    pool,
    `SELECT r.rolname::text AS me, r.rolsuper AS su,
            has_schema_privilege(r.oid, n.oid, 'CREATE') AS login,
            has_schema_privilege('public', n.oid, 'CREATE') AS everyone
       FROM pg_roles r, pg_namespace n
      WHERE r.rolname = current_user AND n.nspname = $1::text`,
    [schema],
  );
  const row = res.rows[0];
  if (!row || row.su || !row.login) return null;
  const via = row.everyone ? " (granted to PUBLIC)" : "";
  return (
    `the app role "${row.me}" can create objects in the schema "${schema}" of the Stratum tables${via}. ` +
    `Only the logins that run the Stratum migrations should: REVOKE CREATE ON SCHEMA ${quoteIdentifier(schema)} ` +
    `FROM ${row.everyone ? "PUBLIC" : quoteIdentifier(row.me)}, and see the guide "Hardening: separate admin and app roles"`
  );
}

/** Whether a stratum_control_plane policy exists in the database. */
async function controlPlanePolicyExists(pool: pg.Pool): Promise<boolean> {
  const res = await pinnedQuery<{ active: boolean }>(
    pool,
    "SELECT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'stratum_control_plane') AS active",
  );
  return res.rows[0]?.active === true;
}

/**
 * Whether migration 032 ran but the control role is not applied: the
 * stratum_security table exists and no stratum_control_plane policy does.
 */
async function hardeningInactive(pool: pg.Pool): Promise<boolean> {
  if ((await schemaOfTable(pool, "stratum_security")) === null) return false;
  return !(await controlPlanePolicyExists(pool));
}

/** Warns, or with `strict` throws, when the application login can create objects in the Stratum schema. */
async function reportSchemaCreate(appPool: pg.Pool, strict: boolean, logger: StratumLogger): Promise<void> {
  const issue = await schemaCreateIssue(appPool);
  if (issue === null) return;
  const message = `[stratum] pool: ${issue}.`;
  if (strict) throw new Error(message);
  logger.warn(message);
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
 * application login throws instead. In every mode it reports an
 * application login that can create objects in the schema of the Stratum
 * tables; with an adminPool and `strict` that is an error too. With an
 * adminPool it also warns when a schema the application login can create
 * would come first on the admin login's search path.
 */
export async function checkRoleModel(options: RoleModelCheckOptions): Promise<void> {
  const { adminPool, appPool, logger } = options;

  if (adminPool) {
    const shadow = await searchPathShadowIssue({ pool: appPool }, { pool: adminPool });
    if (shadow !== null) logger.warn(`[stratum] ${shadow}.`);
  }

  if (await hardeningInactive(adminPool ?? appPool)) {
    logger.warn(
      "Stratum control-role hardening is not active: migration 032 could not apply the control role, " +
        "so this database keeps the pre-1.8 behavior. Run the SQL from bootstrapRolesSql() as a superuser " +
        "(or `stratum db roles`) to activate it.",
    );
    // With adminPool and strict, an application login that can create
    // objects in the Stratum schema is an error, as in the checks below.
    await reportSchemaCreate(appPool, adminPool !== undefined && options.strict, logger);
    return;
  }
  if (!adminPool) {
    // Single-pool mode: the pool's login is the application's. A member of
    // the control role passes every Stratum policy, whatever tenant context
    // it sets, so the pool must not be one.
    const control = options.controlRole ?? (await databaseControlRole(appPool));
    if (control !== null && (await isNonSuperuserMember(appPool, control))) {
      const message =
        `[stratum] pool: the login of pool is a member of the control role "${control}", so row-level security ` +
        `does not limit it to a tenant. Give the library an adminPool (a separate login that is a member), and ` +
        `remove the application login from the control role (REVOKE ${quote(control)} FROM <app login>).`;
      if (options.strict) throw new Error(message);
      logger.warn(message, { control_role: control });
    }
    await reportSchemaCreate(appPool, false, logger);
    return;
  }

  // appRoleIssues() below reports CREATE on the Stratum schema too.
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
  /**
   * The roles, other than superusers, that are members of the control role,
   * directly or through another role. Only the library's admin login (and
   * roles you chose to give the control plane's rights) should be listed.
   */
  controlMembers: { role: string; login: boolean }[];
  /** The admin login that was checked, or null when none was given. */
  adminLogin: string | null;
  /**
   * Why a schema the application login can create would come first on the
   * admin login's search path ("$user"), or null when it would not or when
   * either login was not given.
   */
  searchPathIssue: string | null;
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

  const migrated = (await schemaOfTable(pool, "stratum_security")) !== null;
  const hardeningActive = await controlPlanePolicyExists(pool);
  const control = options.controlRole ?? (await databaseControlRole(pool)) ?? STRATUM_CONTROL_ROLE;

  return {
    migrated,
    hardeningActive,
    controlRole: control,
    adminIssues: adminSubject ? await adminRoleIssues(adminSubject, control) : null,
    appIssues: appSubject ? await appRoleIssues(appSubject, control) : null,
    legacyBypass: switchReader && migrated ? await legacyBypassOn(switchReader) : null,
    controlMembers: await controlRoleMembers(pool, control),
    adminLogin: options.adminRole ?? (adminPool ? await currentLogin(adminPool) : null),
    searchPathIssue: appSubject && adminSubject ? await searchPathShadowIssue(appSubject, adminSubject) : null,
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

