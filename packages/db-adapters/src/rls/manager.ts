import pg from "pg";
import { tablePolicyIssues, type PolicyRow } from "./policy-check.js";

const TENANT_FILTER = "tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid";

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
): Promise<void> {
  const safe = validateTableName(tableName);
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
}

export async function dropPolicy(
  client: pg.PoolClient,
  tableName: string,
): Promise<void> {
  const safe = validateTableName(tableName);
  await client.query(`DROP POLICY IF EXISTS tenant_isolation ON ${safe}`);
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
