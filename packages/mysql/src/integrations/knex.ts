// ─── Structural type for Knex (no hard dependency on knex) ───

export interface KnexQueryBuilderLike {
  where(col: string, val: unknown): this;
  select(...cols: string[]): this;
  insert(data: Record<string, unknown> | Record<string, unknown>[]): Promise<unknown>;
  update(data: Record<string, unknown>): this;
  delete(): this;
  first(): Promise<unknown>;
}

export interface KnexLike {
  (tableName: string): KnexQueryBuilderLike;
}

/**
 * Returns a wrapper function that pre-scopes queries to the given tenant.
 * Call the returned function with a table name to get a WHERE tenant_id = ? builder.
 *
 * INSERT operations automatically inject tenant_id into the data object, so
 * you do not need to include it yourself:
 *   await scoped("users").insert({ name: "Alice" });
 */
export function withTenantScope(
  knex: KnexLike,
  tenantId: string,
): (tableName: string) => KnexQueryBuilderLike {
  return (tableName: string) => {
    const builder = knex(tableName).where("tenant_id", tenantId);
    const originalInsert = builder.insert.bind(builder);
    builder.insert = (data: Record<string, unknown> | Record<string, unknown>[]) => {
      const inject = (row: Record<string, unknown>) => ({ ...row, tenant_id: tenantId });
      const scoped = Array.isArray(data) ? data.map(inject) : inject(data);
      return originalInsert(scoped);
    };
    return builder;
  };
}
