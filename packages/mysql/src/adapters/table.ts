import { validateSlug } from "@stratum-hq/core";
import type {
  MysqlAdapter,
  MysqlTableAdapterOptions,
  MysqlPoolLike,
  PurgeResult,
  AdapterStats,
} from "../types.js";
import { assertTenantId, escapeIdentifier } from "../utils.js";

/**
 * Table-per-tenant adapter: each tenant gets its own set of tables
 * named `{baseTableName}_{tenantSlug}`.
 *
 * No filter injection needed -- isolation is structural.
 */
export class MysqlTableAdapter implements MysqlAdapter {
  private readonly pool: MysqlPoolLike;
  private readonly databaseName: string;

  constructor(options: MysqlTableAdapterOptions) {
    this.pool = options.pool;
    this.databaseName = options.databaseName;
  }

  /**
   * Validates slug and returns the escaped tenant-scoped table name
   * in the form `{baseTableName}_{tenantSlug}`.
   */
  scopedTable(tenantSlug: string, baseTableName: string): string {
    validateSlug(tenantSlug);
    const tableName = `${baseTableName}_${tenantSlug}`;
    return escapeIdentifier(tableName);
  }

  /** Returns the underlying pool for raw queries against tenant tables. */
  getPool(): MysqlPoolLike {
    return this.pool;
  }

  async purgeTenantData(tenantSlug: string): Promise<PurgeResult> {
    assertTenantId(tenantSlug);
    validateSlug(tenantSlug);

    const escapedDb = escapeIdentifier(this.databaseName);
    // SHOW TABLES LIKE '%_tenantSlug' to find all tenant tables.
    const pattern = `%_${tenantSlug}`;
    const [tableRows] = await this.pool.query(
      `SHOW TABLES FROM ${escapedDb} LIKE ?`,
      [pattern],
    ) as [Array<Record<string, string>>, unknown];

    const errors: PurgeResult["errors"] = [];
    let tablesProcessed = 0;

    const exactSuffix = `_${tenantSlug}`;
    for (const row of tableRows) {
      const tableName = Object.values(row)[0];
      if (!tableName) continue;
      // Post-filter: verify exact suffix match to prevent 'e' matching 'orders_acme'
      if (!tableName.endsWith(exactSuffix)) continue;
      try {
        await this.pool.query(`DROP TABLE IF EXISTS ${escapedDb}.${escapeIdentifier(tableName)}`);
        tablesProcessed++;
      } catch (err) {
        errors.push({ table: tableName, error: err as Error });
      }
    }

    return {
      success: errors.length === 0,
      tablesProcessed,
      rowsDeleted: 0,
      errors,
    };
  }

  /** Returns adapter statistics. */
  getStats(): AdapterStats {
    return { strategy: "table-per-tenant" };
  }
}
