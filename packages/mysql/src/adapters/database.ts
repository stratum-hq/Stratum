import { validateSlug } from "@stratum-hq/core";
import type {
  MysqlAdapter,
  MysqlDatabaseAdapterOptions,
  MysqlPoolLike,
  PurgeResult,
  AdapterStats,
} from "../types.js";
import { MysqlPoolManager } from "../pool-manager.js";

/**
 * Database-per-tenant adapter: each tenant gets a dedicated MySQL database.
 * Connections are managed by MysqlPoolManager with LRU eviction.
 */
export class MysqlDatabaseAdapter implements MysqlAdapter {
  private readonly poolManager: MysqlPoolManager;

  constructor(options: MysqlDatabaseAdapterOptions) {
    this.poolManager = new MysqlPoolManager({
      createPool: options.createPool,
      baseUri: options.baseUri,
      maxPools: options.maxPools,
      idleTimeoutMs: options.idleTimeoutMs,
    });
  }

  /** Returns a MysqlPoolLike for the tenant's dedicated database. */
  async getPool(tenantSlug: string): Promise<MysqlPoolLike> {
    validateSlug(tenantSlug);
    return this.poolManager.getPool(tenantSlug);
  }

  async purgeTenantData(tenantSlug: string): Promise<PurgeResult> {
    validateSlug(tenantSlug);
    try {
      const pool = await this.poolManager.getPool(tenantSlug);
      const dbName = `stratum_tenant_${tenantSlug}`;
      await pool.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
      this.poolManager.releasePool(tenantSlug);
      await this.poolManager.closePool(tenantSlug);
      return {
        success: true,
        tablesProcessed: 0,
        rowsDeleted: 0,
        errors: [],
      };
    } catch (err) {
      return {
        success: false,
        tablesProcessed: 0,
        rowsDeleted: 0,
        errors: [{ table: "*", error: err as Error }],
      };
    }
  }

  /** Closes all pooled connections. Call during application shutdown. */
  async closeAll(): Promise<void> {
    await this.poolManager.closeAll();
  }

  /** Returns adapter statistics. */
  getStats(): AdapterStats {
    return {
      strategy: "database-per-tenant",
      ...this.poolManager.getStats(),
    };
  }
}
