// ─── Structural type for Knex (no hard dependency on knex) ───

export interface KnexQueryBuilderLike {
  where(col: string, val: unknown): this;
  select(...cols: string[]): this;
  insert(data: Record<string, unknown>): Promise<unknown>;
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
 */
export function withTenantScope(
  knex: KnexLike,
  tenantId: string,
): (tableName: string) => KnexQueryBuilderLike {
  return (tableName: string) => knex(tableName).where("tenant_id", tenantId);
}
