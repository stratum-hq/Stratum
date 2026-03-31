// ─── Structural types (no hard dependency on sequelize) ───

export interface SequelizeLike {
  query(sql: string, options?: unknown): Promise<unknown>;
  transaction<T>(fn: (t: unknown) => Promise<T>): Promise<T>;
}

/**
 * Runs fn inside a session-variable scope for MySQL tenant isolation.
 * Uses a Sequelize transaction to guarantee all queries (SET, user queries,
 * SET NULL) run on the same pooled connection. The finally block clears the
 * session variable even if fn throws.
 */
export async function withMysqlTenantScope<T>(
  sequelize: SequelizeLike,
  tenantId: string,
  fn: (sequelize: SequelizeLike) => Promise<T>,
): Promise<T> {
  return sequelize.transaction(async (transaction) => {
    await sequelize.query("SET @stratum_tenant_id = ?", {
      replacements: [tenantId],
      transaction,
    });
    try {
      return await fn(sequelize);
    } finally {
      await sequelize.query("SET @stratum_tenant_id = NULL", { transaction });
    }
  });
}
