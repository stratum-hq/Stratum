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
  private readonly baseTables: string[] | undefined;

  constructor(options: MysqlTableAdapterOptions) {
    this.pool = options.pool;
    this.databaseName = options.databaseName;
    if (options.baseTables) {
      for (const a of options.baseTables) {
        for (const b of options.baseTables) {
          if (b.toLowerCase().startsWith(`${a.toLowerCase()}_`)) {
            throw new Error(
              `MysqlTableAdapter: base tables "${a}" and "${b}" are ambiguous, ` +
                `because "${b}_{slug}" can also be read as "${a}_{slug}"`,
            );
          }
        }
      }
      this.baseTables = [...options.baseTables];
    }
  }

  /**
   * Validates slug and returns the escaped tenant-scoped table name
   * in the form `{baseTableName}_{tenantSlug}`.
   */
  scopedTable(tenantSlug: string, baseTableName: string): string {
    validateSlug(tenantSlug);
    if (this.baseTables && !this.baseTables.includes(baseTableName)) {
      throw new Error(`MysqlTableAdapter: "${baseTableName}" is not in baseTables`);
    }
    const tableName = `${baseTableName}_${tenantSlug}`;
    return escapeIdentifier(tableName);
  }

  /** Returns the underlying pool for raw queries against tenant tables. */
  getPool(): MysqlPoolLike {
    return this.pool;
  }

  /**
   * Drops `{base}_{tenantSlug}` for every base in the baseTables option.
   * Throws when baseTables is not set: discovering tables by name suffix would
   * also match other tenants whose slug ends with this one.
   */
  async purgeTenantData(tenantSlug: string): Promise<PurgeResult> {
    assertTenantId(tenantSlug);
    validateSlug(tenantSlug);
    if (!this.baseTables) {
      throw new Error(
        "MysqlTableAdapter: purgeTenantData requires the baseTables option, " +
          "listing every base table name that has a per-tenant copy",
      );
    }

    const escapedDb = escapeIdentifier(this.databaseName);
    const errors: PurgeResult["errors"] = [];
    let tablesProcessed = 0;

    for (const base of this.baseTables) {
      const tableName = `${base}_${tenantSlug}`;
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
