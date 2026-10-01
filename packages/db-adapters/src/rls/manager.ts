import pg from "pg";
import { tablePolicyIssues, type PolicyRow } from "./policy-check.js";

const TENANT_FILTER = "tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid";

/**
 * The read-only subtree predicate of migration 031. It admits the rows of the
 * current tenant's descendants only when the session set app.tenant_scope to
 * 'subtree'. It goes in a FOR SELECT policy only, so writes stay exact.
 */
export const SUBTREE_READ_FILTER =
  "current_setting('app.tenant_scope', true) = 'subtree' " +
  "AND tenant_id = ANY ((SELECT stratum_subtree_tenant_ids())::uuid[])";

export interface CreatePolicyOptions {
  /**
   * Also create the tenant_subtree_read policy, so that a session in the
   * "subtree" scope reads the rows of the tenant's descendants. Needs
   * migration 031 of @stratum-hq/lib. Default false.
   */
  subtreeRead?: boolean;
}

/**
 * Throws when the database has no stratum_subtree_tenant_ids() function. The
 * subtree read policy calls it, and without it CREATE POLICY fails with a
 * less clear error.
 */
export async function assertSubtreeFunction(client: pg.PoolClient): Promise<void> {
  const res = await client.query<{ present: boolean }>(
    "SELECT to_regprocedure('stratum_subtree_tenant_ids()') IS NOT NULL AS present",
  );
  if (!res.rows[0]?.present) {
    throw new Error(
      "[stratum] The subtree read policy needs the function stratum_subtree_tenant_ids(), " +
        "which migration 031 of @stratum-hq/lib creates. Run the Stratum migrations first.",
    );
  }
}

// Validate table name to prevent SQL injection (only allows alphanumeric + underscores)
function validateTableName(tableName: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
    throw new Error(`Invalid table name: ${tableName}`);
  }
  return tableName;
}

export async function createPolicy(
  client: pg.PoolClient,
  tableName: string,
  options: CreatePolicyOptions = {},
): Promise<void> {
  const safe = validateTableName(tableName);
  if (options.subtreeRead) {
    await assertSubtreeFunction(client);
  }
  // Read every policy on the table that the name resolves to, in whichever
  // schema that is. PostgreSQL ORs permissive policies together, so each one
  // must filter by tenant, and a policy's name proves nothing.
  const existing = await client.query<PolicyRow>(
    `SELECT p.policyname, p.permissive, p.cmd, p.qual, p.with_check, p.roles::text[] AS roles
       FROM pg_policies p
       JOIN pg_class c ON c.relname = p.tablename
       JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = p.schemaname
      WHERE c.oid = to_regclass($1)`,
    [safe],
  );
  const issues = tablePolicyIssues(existing.rows);
  if (issues.length > 0) {
    throw new Error(
      `[stratum] Table ${safe} has row-level security policies that do not isolate it by tenant: ` +
        `${issues.join("; ")} (expected ${TENANT_FILTER}). ` +
        `Drop or correct those policies, then call createPolicy again.`,
    );
  }
  if (!existing.rows.some((p) => p.policyname === "tenant_isolation")) {
    // Cannot use parameterized queries inside DO blocks or for DDL identifiers.
    // Table name is validated via allowlist regex above.
    await client.query(`CREATE POLICY tenant_isolation ON ${safe} USING (${TENANT_FILTER})`);
  }
  if (options.subtreeRead && !existing.rows.some((p) => p.policyname === "tenant_subtree_read")) {
    await client.query(
      `CREATE POLICY tenant_subtree_read ON ${safe} FOR SELECT USING (${SUBTREE_READ_FILTER})`,
    );
  }
}

export async function dropPolicy(
  client: pg.PoolClient,
  tableName: string,
): Promise<void> {
  const safe = validateTableName(tableName);
  await client.query(`DROP POLICY IF EXISTS tenant_isolation ON ${safe}`);
  await client.query(`DROP POLICY IF EXISTS tenant_subtree_read ON ${safe}`);
}

export async function enableRLS(
  client: pg.PoolClient,
  tableName: string,
): Promise<void> {
  const safe = validateTableName(tableName);
  await client.query(`ALTER TABLE ${safe} ENABLE ROW LEVEL SECURITY`);
  await client.query(`ALTER TABLE ${safe} FORCE ROW LEVEL SECURITY`);
}

export async function disableRLS(
  client: pg.PoolClient,
  tableName: string,
): Promise<void> {
  const safe = validateTableName(tableName);
  await client.query(`ALTER TABLE ${safe} NO FORCE ROW LEVEL SECURITY`);
  await client.query(`ALTER TABLE ${safe} DISABLE ROW LEVEL SECURITY`);
}

export async function isRLSEnabled(
  client: pg.PoolClient,
  tableName: string,
): Promise<boolean> {
  const safe = validateTableName(tableName);
  // The table the name resolves to, in whichever schema that is.
  const res = await client.query<{ relrowsecurity: boolean }>(
    `SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass($1)`,
    [safe],
  );
  if (res.rows.length === 0) {
    return false;
  }
  return res.rows[0].relrowsecurity;
}
