import type { MysqlPoolLike, MysqlConnectionLike } from "../types.js";
import { escapeIdentifier } from "../utils.js";

/**
 * Creates or replaces a tenant view that filters rows by a session variable.
 *
 * JSDoc caveat: Views are NOT a security boundary (unlike Postgres RLS).
 * Queries to underlying tables bypass isolation. Views referencing session
 * variables may not use indexes efficiently. Benchmark with >100k rows.
 * Use the shared-table adapter for high-performance workloads.
 */
export async function createTenantView(
  pool: MysqlPoolLike,
  tableName: string,
  viewName?: string,
): Promise<void> {
  const resolvedViewName = viewName ?? `${tableName}_tenant_view`;
  const escapedView = escapeIdentifier(resolvedViewName);
  const escapedTable = escapeIdentifier(tableName);

  const sql =
    `CREATE OR REPLACE VIEW ${escapedView} AS ` +
    `SELECT * FROM ${escapedTable} WHERE tenant_id = @stratum_tenant_id`;

  await pool.query(sql);
}

/** Drops a tenant view if it exists. */
export async function dropTenantView(
  pool: MysqlPoolLike,
  viewName: string,
): Promise<void> {
  const escapedView = escapeIdentifier(viewName);
  await pool.query(`DROP VIEW IF EXISTS ${escapedView}`);
}

/**
 * Sets the session variable used by tenant views.
 * Pass null to clear the variable after a request completes.
 */
export async function setTenantSession(
  connection: MysqlConnectionLike,
  tenantId: string | null,
): Promise<void> {
  if (tenantId === null) {
    await connection.execute(`SET @stratum_tenant_id = NULL`);
  } else {
    await connection.execute(`SET @stratum_tenant_id = ?`, [tenantId]);
  }
}
