import type {
  MysqlAdapter,
  MysqlSharedAdapterOptions,
  MysqlPoolLike,
  PurgeResult,
  AdapterStats,
} from "../types.js";
import { assertTenantId, escapeIdentifier, aggregatePurgeResults } from "../utils.js";

/**
 * Shared-table adapter: all tenants share the same tables, isolated by a
 * `tenant_id` column injected into every query via structured methods.
 */
export class MysqlSharedAdapter implements MysqlAdapter {
  private readonly pool: MysqlPoolLike;
  private readonly databaseName: string;

  constructor(options: MysqlSharedAdapterOptions) {
    this.pool = options.pool;
    this.databaseName = options.databaseName;
  }

  /**
   * SELECT with WHERE tenant_id = ?. conditions is a Record turned into AND clauses.
   * columns defaults to *.
   */
  async scopedSelect(
    tenantId: string,
    table: string,
    conditions?: Record<string, unknown>,
    columns: string[] = ["*"],
  ): Promise<unknown[]> {
    assertTenantId(tenantId);

    const cols = columns.map((c) => (c === "*" ? "*" : escapeIdentifier(c))).join(", ");
    const qualifiedTable = `${escapeIdentifier(this.databaseName)}.${escapeIdentifier(table)}`;

    const whereClauses: string[] = [`tenant_id = ?`];
    const values: unknown[] = [tenantId];

    if (conditions) {
      for (const [col, val] of Object.entries(conditions)) {
        whereClauses.push(`${escapeIdentifier(col)} = ?`);
        values.push(val);
      }
    }

    const sql = `SELECT ${cols} FROM ${qualifiedTable} WHERE ${whereClauses.join(" AND ")}`;
    const [rows] = await this.pool.query(sql, values) as [unknown[], unknown];
    return rows;
  }

  /** INSERT with tenant_id added to data. */
  async scopedInsert(
    tenantId: string,
    table: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    assertTenantId(tenantId);

    const row = { ...data, tenant_id: tenantId };
    const qualifiedTable = `${escapeIdentifier(this.databaseName)}.${escapeIdentifier(table)}`;
    const cols = Object.keys(row).map(escapeIdentifier).join(", ");
    const placeholders = Object.keys(row).map(() => "?").join(", ");
    const values = Object.values(row);

    const sql = `INSERT INTO ${qualifiedTable} (${cols}) VALUES (${placeholders})`;
    return this.pool.query(sql, values);
  }

  /** UPDATE SET ... WHERE tenant_id = ? AND conditions. */
  async scopedUpdate(
    tenantId: string,
    table: string,
    data: Record<string, unknown>,
    conditions: Record<string, unknown>,
  ): Promise<unknown> {
    assertTenantId(tenantId);

    const qualifiedTable = `${escapeIdentifier(this.databaseName)}.${escapeIdentifier(table)}`;
    const setClauses = Object.keys(data)
      .map((col) => `${escapeIdentifier(col)} = ?`)
      .join(", ");
    const setValues = Object.values(data);

    const whereClauses: string[] = [`tenant_id = ?`];
    const whereValues: unknown[] = [tenantId];

    for (const [col, val] of Object.entries(conditions)) {
      whereClauses.push(`${escapeIdentifier(col)} = ?`);
      whereValues.push(val);
    }

    const sql = `UPDATE ${qualifiedTable} SET ${setClauses} WHERE ${whereClauses.join(" AND ")}`;
    return this.pool.query(sql, [...setValues, ...whereValues]);
  }

  /** DELETE WHERE tenant_id = ? AND optional conditions. */
  async scopedDelete(
    tenantId: string,
    table: string,
    conditions?: Record<string, unknown>,
  ): Promise<unknown> {
    assertTenantId(tenantId);

    const qualifiedTable = `${escapeIdentifier(this.databaseName)}.${escapeIdentifier(table)}`;
    const whereClauses: string[] = [`tenant_id = ?`];
    const values: unknown[] = [tenantId];

    if (conditions) {
      for (const [col, val] of Object.entries(conditions)) {
        whereClauses.push(`${escapeIdentifier(col)} = ?`);
        values.push(val);
      }
    }

    const sql = `DELETE FROM ${qualifiedTable} WHERE ${whereClauses.join(" AND ")}`;
    return this.pool.query(sql, values);
  }

  /**
   * Executes SQL as-is. Caller owns the WHERE clause and all tenant scoping.
   * No tenant_id injection is performed.
   */
  async scopedRawQuery(sql: string, params?: unknown[]): Promise<unknown> {
    return this.pool.query(sql, params);
  }

  async purgeTenantData(tenantId: string): Promise<PurgeResult> {
    assertTenantId(tenantId);

    // Discover all tables that have a tenant_id column in this database.
    const [tableRows] = await this.pool.query(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE COLUMN_NAME = 'tenant_id' AND TABLE_SCHEMA = ?`,
      [this.databaseName],
    ) as [Array<{ TABLE_NAME: string }>, unknown];

    const results = await Promise.allSettled(
      tableRows.map(async (row) => {
        const qualifiedTable = `${escapeIdentifier(this.databaseName)}.${escapeIdentifier(row.TABLE_NAME)}`;
        const [result] = await this.pool.query(
          `DELETE FROM ${qualifiedTable} WHERE tenant_id = ?`,
          [tenantId],
        ) as [{ affectedRows?: number }, unknown];
        return { table: row.TABLE_NAME, rowsDeleted: result.affectedRows ?? 0 };
      }),
    );

    return aggregatePurgeResults(results);
  }

  /** Returns adapter statistics. */
  getStats(): AdapterStats {
    return { strategy: "shared" };
  }
}
