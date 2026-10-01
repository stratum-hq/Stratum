import type pg from "pg";
import { STRATUM_CONTROL_ROLE } from "./migration-sql.js";
import { PINNED_SEARCH_PATH, quoteIdentifier, schemaOfTable } from "./pinned-query.js";

/**
 * The canonical row-level security of the Stratum tables: the tables that
 * have it and every policy on them, as migrations 019, 020, 031 and 032
 * leave them. stratum_apply_control_role() of migration 032 drops every
 * policy on these tables and re-creates exactly this set (a unit test checks
 * that the function's SQL is the one policiesPlpgsql() renders), and
 * stratumPolicyDrift() compares a database with it.
 */

/** The Stratum tables with row-level security enabled and forced. */
export const STRATUM_RLS_TABLES: readonly string[] = Object.freeze([
  "tenants",
  "config_entries",
  "permission_policies",
  "audit_logs",
  "webhook_events",
  "webhook_deliveries",
  "webhooks",
  "consent_records",
  "abac_policies",
  "api_keys",
  "roles",
  "principal_roles",
  "usage_events",
  "regions",
  "stratum_security",
]);

export interface StratumPolicy {
  table: string;
  name: string;
  cmd: "ALL" | "SELECT";
  /** "control" for the control role, else PUBLIC. */
  to: "control" | "public";
  using: string;
  check: string | null;
}

const LEGACY = "(SELECT %1$I.stratum_legacy_bypass())";
const CURRENT_TENANT = "NULLIF(current_setting('app.current_tenant_id', true), '')::uuid";
const SUBTREE = "((SELECT %1$I.stratum_subtree_tenant_ids())::uuid[])";
const SCOPE = "current_setting('app.tenant_scope', true) = 'subtree'";

/** Tables whose rows carry tenant_id. */
const TENANT_ID_TABLES = [
  "config_entries",
  "permission_policies",
  "audit_logs",
  "webhook_events",
  "webhooks",
  "consent_records",
  "abac_policies",
  "api_keys",
  "roles",
  "usage_events",
];

/** Tables with the subtree read of migration 031 (not webhooks or api_keys, which hold credentials). */
const SUBTREE_TENANT_ID_TABLES = TENANT_ID_TABLES.filter((t) => t !== "webhooks" && t !== "api_keys");

/** Rows scoped through a parent table: the scope of the parent's tenant_id. */
const VIA_PARENT: Record<string, string> = {
  webhook_deliveries: "SELECT 1 FROM %1$I.webhook_events we WHERE we.id = webhook_deliveries.event_id AND we.tenant_id",
  principal_roles: "SELECT 1 FROM %1$I.roles r WHERE r.id = principal_roles.role_id AND r.tenant_id",
};

/** Every canonical policy, in a fixed order. */
export function stratumPolicies(): StratumPolicy[] {
  const policies: StratumPolicy[] = [];
  const isolation = (table: string, scope: string): void => {
    const expr = `${LEGACY} OR ${scope}`;
    policies.push({ table, name: "tenant_isolation", cmd: "ALL", to: "public", using: expr, check: expr });
  };
  const subtree = (table: string, scope: string): void => {
    policies.push({ table, name: "tenant_subtree_read", cmd: "SELECT", to: "public", using: `${SCOPE} AND ${scope}`, check: null });
  };

  for (const table of TENANT_ID_TABLES) isolation(table, `tenant_id = ${CURRENT_TENANT}`);
  isolation("tenants", `id = ${CURRENT_TENANT}`);
  for (const [table, join] of Object.entries(VIA_PARENT)) isolation(table, `EXISTS (${join} = ${CURRENT_TENANT})`);

  for (const table of SUBTREE_TENANT_ID_TABLES) {
    subtree(table, table === "config_entries" ? `tenant_id = ANY ${SUBTREE} AND NOT sensitive` : `tenant_id = ANY ${SUBTREE}`);
  }
  subtree("tenants", `id = ANY ${SUBTREE}`);
  for (const [table, join] of Object.entries(VIA_PARENT)) subtree(table, `EXISTS (${join} = ANY ${SUBTREE})`);

  policies.push({ table: "regions", name: "stratum_legacy_bypass", cmd: "ALL", to: "public", using: LEGACY, check: LEGACY });
  for (const table of STRATUM_RLS_TABLES) {
    policies.push({ table, name: "stratum_control_plane", cmd: "ALL", to: "control", using: "true", check: "true" });
  }
  return policies;
}

/**
 * The CREATE POLICY statement of `p`, with the format() placeholders %1$I for
 * the schema and, for the control role, %2$I for the role. Every Stratum
 * object the expressions name is qualified with the schema, because
 * stratum_apply_control_role() runs with search_path = pg_catalog, pg_temp.
 */
function createPolicyTemplate(p: StratumPolicy): string {
  const to = p.to === "control" ? " AS PERMISSIVE FOR ALL TO %2$I" : ` FOR ${p.cmd}`;
  const check = p.check === null ? "" : ` WITH CHECK (${p.check})`;
  return `CREATE POLICY ${p.name} ON %1$I.${p.table}${to} USING (${p.using})${check}`;
}

/**
 * `text` with the schema placeholder replaced by `schema`, for the canonical
 * policies that stratumPolicyDrift() puts on temporary tables: the functions
 * and tables they name are the live Stratum ones, as in the live policies.
 */
function inSchema(text: string, schema: string): string {
  return text.split("%1$I.").join(`${quoteIdentifier(schema)}.`);
}

/**
 * The PL/pgSQL statements of stratum_apply_control_role() that reset the
 * row-level security of the Stratum tables: every policy on them is dropped,
 * RLS is enabled and forced, and the canonical policies are created. They
 * expect the variables v_schema, v_role, v_table and v_policy.
 */
export function policiesPlpgsql(): string {
  const lines = [
    "  FOREACH v_table IN ARRAY v_tables LOOP",
    "    FOR v_policy IN",
    "      SELECT p.polname FROM pg_policy p WHERE p.polrelid = format('%I.%I', v_schema, v_table)::regclass",
    "    LOOP",
    "      EXECUTE format('DROP POLICY %I ON %I.%I', v_policy, v_schema, v_table);",
    "    END LOOP;",
    "    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', v_schema, v_table);",
    "    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', v_schema, v_table);",
    "  END LOOP;",
  ];
  for (const p of stratumPolicies()) {
    const args = p.to === "control" ? "v_schema, v_role" : "v_schema";
    lines.push(`  EXECUTE format($pol$${createPolicyTemplate(p)}$pol$, ${args});`);
  }
  return lines.join("\n");
}

export interface PolicyDriftOptions {
  /** The control role. Default: the role of the database's stratum_control_plane policies, else stratum_control. */
  controlRole?: string;
}

/**
 * The differences between the row-level security of the Stratum tables in
 * the schema of `tenants` (on the search path of `pool`) and the canonical
 * set: tables without RLS enabled and forced, and policies that are missing,
 * extra, or differ in command, roles or expressions. Empty when they match.
 * Before the control role is applied (no stratum_control_plane policy
 * anywhere), the control policies, and FORCE on stratum_security, are not
 * expected.
 *
 * The canonical expressions are deparsed by the same server: the check
 * creates temporary tables with the same names and columns, puts the
 * canonical policies on them, and compares pg_get_expr() of both, all in a
 * transaction that it rolls back. It needs only the TEMP privilege. The
 * transaction's search path is pg_catalog only (see pinned-query.ts), so
 * both sides print the Stratum names with their schema.
 */
export async function stratumPolicyDrift(pool: pg.Pool, options: PolicyDriftOptions = {}): Promise<string[]> {
  const nsp = await schemaOfTable(pool);
  if (!nsp) return ["the tenants table was not found; run the Stratum migrations"];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL search_path = ${PINNED_SEARCH_PATH}`);
    const ns = await client.query<{ control: string | null }>(
      `SELECT (SELECT min(r::text) FROM pg_policies p, unnest(p.roles) r WHERE p.policyname = 'stratum_control_plane') AS control`,
    );
    const applied = ns.rows[0].control !== null;
    const control = options.controlRole ?? ns.rows[0].control ?? STRATUM_CONTROL_ROLE;
    const expected = stratumPolicies().filter((p) => applied || p.to !== "control");

    const policyQuery = (namespace: string) =>
      client.query<{ tbl: string; name: string; permissive: boolean; cmd: string; roles: string[]; qual: string | null; chk: string | null }>(
        `SELECT c.relname AS tbl, p.polname AS name, p.polpermissive AS permissive, p.polcmd::text AS cmd,
                ARRAY(SELECT CASE WHEN r = 0 THEN 'public' ELSE pg_get_userbyid(r)::text END FROM unnest(p.polroles) r ORDER BY 1) AS roles,
                pg_get_expr(p.polqual, p.polrelid) AS qual, pg_get_expr(p.polwithcheck, p.polrelid) AS chk
           FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
          WHERE c.relnamespace = (SELECT n.oid FROM pg_namespace n WHERE n.nspname = $1::text) AND c.relname = ANY ($2::text[])`,
        [namespace, STRATUM_RLS_TABLES],
      );

    const issues: string[] = [];
    const flags = await client.query<{ relname: string; on: boolean; forced: boolean }>(
      `SELECT c.relname, c.relrowsecurity AS on, c.relforcerowsecurity AS forced FROM pg_class c
        WHERE c.relnamespace = (SELECT n.oid FROM pg_namespace n WHERE n.nspname = $1::text) AND c.relname = ANY ($2::text[])`,
      [nsp, STRATUM_RLS_TABLES],
    );
    for (const f of flags.rows) {
      // Until the control role is applied, migration 032 leaves stratum_security
      // without FORCE, so that its owner's definer function can read it.
      const forceExpected = applied || f.relname !== "stratum_security";
      if (!f.on || (forceExpected && !f.forced)) {
        issues.push(`${f.relname}: row-level security is not enabled${forceExpected ? " and forced" : ""}`);
      }
    }
    const live = (await policyQuery(nsp)).rows;

    // The canonical policies, on temporary tables of the same names and columns.
    const columns = await client.query<{ relname: string; cols: string }>(
      `SELECT c.relname, string_agg(format('%I %s', a.attname, format_type(a.atttypid, a.atttypmod)), ', ' ORDER BY a.attnum) AS cols
         FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
        WHERE c.relnamespace = (SELECT n.oid FROM pg_namespace n WHERE n.nspname = $1::text) AND c.relname = ANY ($2::text[])
        GROUP BY c.relname`,
      [nsp, STRATUM_RLS_TABLES],
    );
    for (const t of columns.rows) {
      await client.query(`CREATE TEMP TABLE pg_temp."${t.relname}" (${t.cols}) ON COMMIT DROP`);
    }
    for (const p of expected) {
      if (!columns.rows.some((t) => t.relname === p.table)) continue;
      const to = p.to === "control" ? ` AS PERMISSIVE FOR ALL TO "${control}"` : ` FOR ${p.cmd}`;
      const check = p.check === null ? "" : ` WITH CHECK (${inSchema(p.check, nsp)})`;
      await client.query(`CREATE POLICY ${p.name} ON pg_temp."${p.table}"${to} USING (${inSchema(p.using, nsp)})${check}`);
    }
    const temp = await client.query<{ nsp: string }>("SELECT pg_my_temp_schema()::regnamespace::text AS nsp");
    const canonical = (await policyQuery(temp.rows[0].nsp)).rows;

    const key = (r: { tbl: string; name: string }) => `${r.tbl}.${r.name}`;
    const liveByKey = new Map(live.map((r) => [key(r), r]));
    for (const c of canonical) {
      const l = liveByKey.get(key(c));
      if (!l) {
        issues.push(`${c.tbl}: policy ${c.name} is missing`);
        continue;
      }
      liveByKey.delete(key(c));
      const differs =
        l.permissive !== c.permissive ||
        l.cmd !== c.cmd ||
        l.roles.join(",") !== c.roles.join(",") ||
        l.qual !== c.qual ||
        l.chk !== c.chk;
      if (differs) issues.push(`${c.tbl}: policy ${c.name} differs from migration 032`);
    }
    for (const l of liveByKey.values()) issues.push(`${l.tbl}: policy ${l.name} is not a Stratum policy`);
    return issues;
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}
