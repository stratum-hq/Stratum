import pg from "pg";

export interface DatabasePoolManagerOptions {
  /** Template connection config (host, port, user, password, ssl, etc.) — database name is overridden per tenant. */
  baseConnectionConfig: pg.PoolConfig;
  /** Maximum number of tenant pools to keep open simultaneously. Default: 50. */
  maxPools?: number;
  /** Milliseconds of inactivity before a pool is eligible for LRU eviction. Default: 30000. */
  idleTimeoutMs?: number;
}

interface PoolEntry {
  pool: pg.Pool;
  lastUsed: number;
}

/**
 * Manages a collection of per-tenant pg.Pool instances.
 *
 * Pools are keyed by tenant slug and created on first access.
 * When the pool count exceeds maxPools, the least-recently-used pool is evicted.
 */
export class DatabasePoolManager {
  private readonly pools: Map<string, PoolEntry> = new Map();
  private readonly baseConfig: pg.PoolConfig;
  private readonly maxPools: number;
  private readonly idleTimeoutMs: number;

  constructor(options: DatabasePoolManagerOptions) {
    this.baseConfig = options.baseConnectionConfig;
    this.maxPools = options.maxPools ?? 50;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 30_000;
  }

  /** Validates tenant slug to prevent injection in database names. */
  private validateSlug(slug: string): void {
    if (!/^[a-z][a-z0-9_]*$/.test(slug)) {
      throw new Error(
        `Invalid tenant slug: "${slug}". Slugs must start with a lowercase letter and contain only lowercase alphanumeric characters and underscores.`,
      );
    }
    if (slug.length > 63) {
      throw new Error(`Tenant slug too long (max 63 chars): "${slug}"`);
    }
  }

  /**
   * Returns an existing pool for the tenant slug, or creates a new one.
   * Evicts the LRU pool if the pool limit is reached.
   *
   * When a regionId is provided, the pool is keyed as `regionId:slug` to support
   * multi-region deployments where the same slug may exist in different regions.
   */
  getPool(tenantSlug: string, regionId?: string): pg.Pool {
    this.validateSlug(tenantSlug);
    const poolKey = regionId ? `${regionId}:${tenantSlug}` : tenantSlug;
    const existing = this.pools.get(poolKey);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing.pool;
    }

    // Evict before adding so we never exceed maxPools.
    if (this.pools.size >= this.maxPools) {
      void this.evictLRU();
    }

    const dbName = `stratum_tenant_${tenantSlug}`;
    const pool = new pg.Pool({
      ...this.baseConfig,
      database: dbName,
      idleTimeoutMillis: this.idleTimeoutMs,
    });

    this.pools.set(poolKey, { pool, lastUsed: Date.now() });
    return pool;
  }

  /** Closes and removes the pool for the given tenant slug. No-op if not found. */
  async closePool(tenantSlug: string): Promise<void> {
    const entry = this.pools.get(tenantSlug);
    if (!entry) return;
    this.pools.delete(tenantSlug);
    await entry.pool.end();
  }

  /** Closes all managed pools. Call during application shutdown. */
  async closeAll(): Promise<void> {
    const entries = Array.from(this.pools.entries());
    this.pools.clear();
    await Promise.all(entries.map(([, entry]) => entry.pool.end()));
  }

  /** Returns a snapshot of current pool statistics. */
  getStats(): { poolCount: number; activeConnections: number } {
    let activeConnections = 0;
    for (const entry of this.pools.values()) {
      // pg.Pool exposes totalCount (all clients) and idleCount; active = total - idle
      activeConnections +=
        (entry.pool as unknown as { totalCount: number }).totalCount -
        (entry.pool as unknown as { idleCount: number }).idleCount;
    }
    return { poolCount: this.pools.size, activeConnections };
  }

  /** Evicts the pool that has been idle the longest. */
  private async evictLRU(): Promise<void> {
    let oldestKey: string | undefined;
    let oldestTime = Infinity;

    for (const [key, entry] of this.pools.entries()) {
      if (entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed;
        oldestKey = key;
      }
    }

    if (oldestKey !== undefined) {
      await this.closePool(oldestKey);
    }
  }
}
