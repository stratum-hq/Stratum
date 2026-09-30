// ─── Structural types (no hard dependency on sequelize) ───

export interface SequelizeLike {
  query(sql: string, options?: unknown): Promise<unknown>;
  transaction<T>(fn: (t: unknown) => Promise<T>): Promise<T>;
}

/**
 * Runs fn inside a session-variable scope for MySQL tenant isolation.
 * Sets @stratum_tenant_id inside a Sequelize transaction and clears it in a
 * finally block, even if fn throws.
 *
 * The variable exists only on the transaction's connection. fn receives that
 * transaction as its second argument, and every query inside fn must pass it
 * (`{ transaction }`); a query without it runs on another pooled connection
 * where the variable is not set.
 */
export async function withMysqlTenantScope<T>(
  sequelize: SequelizeLike,
  tenantId: string,
  fn: (sequelize: SequelizeLike, transaction: unknown) => Promise<T>,
): Promise<T> {
  return sequelize.transaction(async (transaction) => {
    await sequelize.query("SET @stratum_tenant_id = ?", {
      replacements: [tenantId],
      transaction,
    });
    try {
      return await fn(sequelize, transaction);
    } finally {
      await sequelize.query("SET @stratum_tenant_id = NULL", { transaction });
    }
  });
}
