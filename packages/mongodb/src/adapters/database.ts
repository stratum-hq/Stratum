import { validateSlug } from "@stratum-hq/core";
import type {
  MongoAdapter,
  MongoDatabaseAdapterOptions,
  PurgeResult,
  AdapterStats,
  DatabaseLike,
} from "../types.js";
import { MongoPoolManager } from "../pool-manager.js";

/**
 * Database-per-tenant adapter: each tenant gets a dedicated MongoDB database.
 * Connections are managed by MongoPoolManager with LRU eviction.
 */
export class MongoDatabaseAdapter implements MongoAdapter {
  private readonly poolManager: MongoPoolManager;

  constructor(options: MongoDatabaseAdapterOptions) {
    this.poolManager = new MongoPoolManager({
      createClient: options.createClient,
      baseUri: options.baseUri,
      maxClients: options.maxClients,
      idleTimeoutMs: options.idleTimeoutMs,
    });
  }

  /** Returns a DatabaseLike reference for the tenant's dedicated database. */
  async getDatabase(tenantSlug: string): Promise<DatabaseLike> {
    validateSlug(tenantSlug);
    const client = await this.poolManager.getClient(tenantSlug);
    const dbName = `stratum_tenant_${tenantSlug}`;
    return client.db(dbName);
  }

  async purgeTenantData(tenantSlug: string): Promise<PurgeResult> {
    validateSlug(tenantSlug);
    try {
      const db = await this.getDatabase(tenantSlug);
      await db.dropDatabase();
      await this.poolManager.closeClient(tenantSlug);
      return {
        success: true,
        collectionsProcessed: 0,
        documentsDeleted: 0,
        errors: [],
      };
    } catch (err) {
      return {
        success: false,
        collectionsProcessed: 0,
        documentsDeleted: 0,
        errors: [{ collection: "*", error: err as Error }],
      };
    }
  }

  getStats(): AdapterStats {
    return {
      strategy: "database-per-tenant",
      ...this.poolManager.getStats(),
    };
  }

  /** Closes all pooled connections. Call during application shutdown. */
  async closeAll(): Promise<void> {
    await this.poolManager.closeAll();
  }
}
