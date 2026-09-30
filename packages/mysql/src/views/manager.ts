import type { MysqlPoolLike, MysqlConnectionLike } from "../types.js";
import { escapeIdentifier } from "../utils.js";

/**
 * @deprecated Not supported on MySQL, and always throws.
 *
 * MySQL rejects a view whose SELECT reads a user variable
 * (ER_VIEW_SELECT_VARIABLE), so a view filtered on `@stratum_tenant_id` cannot
 * be created. Use the shared-table adapter's scoped methods instead.
 */
export async function createTenantView(
  _pool: MysqlPoolLike,
  _tableName: string,
  _viewName?: string,
): Promise<void> {
  throw new Error(
    "createTenantView is not supported: MySQL does not allow a view to read the " +
      "@stratum_tenant_id session variable. Use MysqlSharedAdapter's scoped methods instead.",
  );
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
