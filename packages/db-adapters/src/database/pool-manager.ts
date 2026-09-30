import pg from "pg";
import { getDatabaseName } from "./manager.js";

export interface DatabasePoolManagerOptions {
  /** Template connection config (host, port, user, password, ssl, etc.) — database name is overridden per tenant. */
  baseConnectionConfig: pg.PoolConfig;
  /** Maximum number of tenant pools to keep open simultaneously. Default: 50. */
  maxPools?: number;
  /**
   * Milliseconds an idle connection stays open inside a tenant pool before pg
   * closes it. The manager passes it to pg.Pool as idleTimeoutMillis. It does
   * not control LRU eviction. Default: 30000.
   */
  idleTimeoutMs?: number;
}

interface PoolEntry {
  pool: pg.Pool;
  lastUsed: number;
  /** Callers that received this pool from getPool and have not called releasePool. */
  refCount: number;
}

/**
 * Manages a collection of per-tenant pg.Pool instances.
 *
 * Pools are keyed by tenant slug and created on first access. Each getPool call
 * holds the pool until the caller calls releasePool. When the pool count reaches
 * maxPools, the least-recently-used pool that no caller holds is evicted. A pool
 * that a caller holds is never evicted, so the count can exceed maxPools while
 * every pool is in use.
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

  /**
   * Returns the pool for the tenant slug, and creates it on first access.
   * Each call holds the pool until the caller calls releasePool with the same
   * arguments. A held pool is never evicted.
   *
   * When a regionId is provided, the pool is keyed as `regionId:slug` to support
   * multi-region deployments where the same slug may exist in different regions.
   */
  async getPool(tenantSlug: string, regionId?: string): Promise<pg.Pool> {
    const dbName = getDatabaseName(tenantSlug);
    const poolKey = regionId ? `${regionId}:${tenantSlug}` : tenantSlug;

    // The lookup, the eviction choice and the insert run with no await between
    // them. Thus a concurrent call for the same key always finds this entry.
    let entry = this.pools.get(poolKey);
    let victim: pg.Pool | undefined;
    if (!entry) {
      if (this.pools.size >= this.maxPools) victim = this.takeLRU();
      entry = {
        pool: new pg.Pool({
          ...this.baseConfig,
          database: dbName,
          idleTimeoutMillis: this.idleTimeoutMs,
        }),
        lastUsed: Date.now(),
        refCount: 0,
      };
      this.pools.set(poolKey, entry);
    }

    entry.lastUsed = Date.now();
    entry.refCount++;
    if (victim) {
      try {
        await victim.end();
      } catch (err) {
        // The caller gets no pool, so it will not call releasePool.
        entry.refCount--;
        throw err;
      }
    }
    return entry.pool;
  }

  /**
   * Ends one hold on the pool that getPool returned for the same arguments.
   * Call it once for each getPool call. No-op if the pool is not tracked.
   */
  releasePool(tenantSlug: string, regionId?: string): void {
    const poolKey = regionId ? `${regionId}:${tenantSlug}` : tenantSlug;
    const entry = this.pools.get(poolKey);
    if (!entry || entry.refCount === 0) return;
    entry.refCount--;
    entry.lastUsed = Date.now();
  }

  /** Closes and removes the pool for the given tenant slug. No-op if not found.
   * Accepts either a bare slug or a region-prefixed key (`regionId:slug`). */
  async closePool(tenantSlug: string, regionId?: string): Promise<void> {
    const poolKey = regionId ? `${regionId}:${tenantSlug}` : tenantSlug;
    // Also check for any region-prefixed key that ends with this slug when
    // no regionId is provided, so callers don't have to know the prefix.
    let resolvedKey = poolKey;
    if (!this.pools.has(poolKey) && !regionId) {
      for (const key of this.pools.keys()) {
        if (key === tenantSlug || key.endsWith(`:${tenantSlug}`)) {
          resolvedKey = key;
          break;
        }
      }
    }
    const entry = this.pools.get(resolvedKey);
    if (!entry) return;
    this.pools.delete(resolvedKey);
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

  /**
   * Removes the least-recently-used pool that no caller holds from the map and
   * returns it. The caller ends it. Returns undefined when every pool is held.
   */
  private takeLRU(): pg.Pool | undefined {
    let oldestKey: string | undefined;
    let oldestTime = Infinity;

    for (const [key, entry] of this.pools.entries()) {
      if (entry.refCount === 0 && entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed;
        oldestKey = key;
      }
    }

    if (oldestKey === undefined) return undefined;
    const entry = this.pools.get(oldestKey)!;
    this.pools.delete(oldestKey);
    return entry.pool;
  }
}
