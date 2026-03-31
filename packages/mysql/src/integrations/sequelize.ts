// ─── Structural types (no hard dependency on sequelize) ───

export interface SequelizeLike {
  query(sql: string, options?: unknown): Promise<unknown>;
  transaction(fn: (t: unknown) => Promise<unknown>): Promise<unknown>;
}

/**
 * Runs fn inside a session-variable scope for MySQL tenant isolation.
 * Sets @stratum_tenant_id before calling fn and clears it in a finally block
 * to guarantee cleanup even if fn throws.
 */
export async function withMysqlTenantScope<T>(
  sequelize: SequelizeLike,
  tenantId: string,
  fn: (sequelize: SequelizeLike) => Promise<T>,
): Promise<T> {
  await sequelize.query("SET @stratum_tenant_id = ?", { replacements: [tenantId] });
  try {
    return await fn(sequelize);
  } finally {
    await sequelize.query("SET @stratum_tenant_id = NULL");
  }
}
