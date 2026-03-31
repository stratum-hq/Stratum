import { validateSlug } from "@stratum-hq/core";
import type { MysqlPoolLike, MysqlPoolManagerOptions } from "./types.js";

interface PoolEntry {
  pool: MysqlPoolLike;
  lastUsed: number;
  /** Number of active callers holding this pool. */
  refCount: number;
}

/**
 * Manages a collection of per-tenant MySQL connection pools with LRU eviction
 * and active-query-aware reference counting.
 *
 * Pools are keyed by tenant slug and created on first access.
 * When the pool count exceeds maxPools, the least-recently-used pool
 * with refCount === 0 is evicted. A background timer closes pools
 * that have been idle for longer than idleTimeoutMs.
 */
export class MysqlPoolManager {
  private readonly pools: Map<string, PoolEntry> = new Map();
  private readonly createPool: (uri: string) => MysqlPoolLike | Promise<MysqlPoolLike>;
  private readonly baseUri: string;
  private readonly maxPools: number;
  private readonly idleTimeoutMs: number;
  private readonly idleTimer: ReturnType<typeof setInterval>;
  /** Exposed for testing: resolves when the last idle cleanup completes. */
  _lastCleanup: Promise<void> = Promise.resolve();

  constructor(options: MysqlPoolManagerOptions) {
    this.createPool = options.createPool;
    this.baseUri = options.baseUri;
    this.maxPools = options.maxPools ?? 20;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 60_000;

    this.idleTimer = setInterval(() => {
      this._lastCleanup = this.closeIdlePools();
    }, this.idleTimeoutMs);

    // Allow Node.js to exit even if the timer is still running.
    if (typeof this.idleTimer.unref === "function") {
      this.idleTimer.unref();
    }
  }

  /**
   * Returns a cached MysqlPoolLike for the given tenant slug, creating one if needed.
   * Increments refCount for the pool. Caller must call releasePool() when done.
   * Evicts the LRU pool (with refCount === 0) if the pool map is at capacity.
   */
  async getPool(slug: string): Promise<MysqlPoolLike> {
    validateSlug(slug);

    const existing = this.pools.get(slug);
    if (existing) {
      existing.lastUsed = Date.now();
      existing.refCount++;
      return existing.pool;
    }

    // Evict before adding so we never exceed maxPools.
    if (this.pools.size >= this.maxPools) {
      await this.evictLRU();
    }

    const dbName = `stratum_tenant_${slug}`;
    const uri = this.buildUri(dbName);
    const pool = await this.createPool(uri);

    this.pools.set(slug, { pool, lastUsed: Date.now(), refCount: 1 });
    return pool;
  }

  /**
   * Decrements the refCount for the pool associated with the given slug.
   * No-op if the slug is not tracked.
   */
  releasePool(slug: string): void {
    const entry = this.pools.get(slug);
    if (!entry) return;
    if (entry.refCount > 0) {
      entry.refCount--;
    }
  }

  /** Closes and removes the pool for the given slug. No-op if not found. */
  async closePool(slug: string): Promise<void> {
    const entry = this.pools.get(slug);
    if (!entry) return;
    this.pools.delete(slug);
    await entry.pool.end();
  }

  /** Closes all managed pools and stops the idle timer. Call during application shutdown. */
  async closeAll(): Promise<void> {
    clearInterval(this.idleTimer);
    const entries = Array.from(this.pools.entries());
    this.pools.clear();
    await Promise.all(entries.map(([, entry]) => entry.pool.end()));
  }

  /** Returns a snapshot of current pool statistics. */
  getStats(): { poolCount: number } {
    return { poolCount: this.pools.size };
  }

  /** Evicts the pool that has been idle the longest and has no active references. */
  private async evictLRU(): Promise<void> {
    let oldestKey: string | undefined;
    let oldestTime = Infinity;

    for (const [key, entry] of this.pools.entries()) {
      if (entry.refCount === 0 && entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed;
        oldestKey = key;
      }
    }

    if (oldestKey !== undefined) {
      await this.closePool(oldestKey);
    }
  }

  /** Closes pools that have been idle longer than idleTimeoutMs and have no active references. */
  private async closeIdlePools(): Promise<void> {
    const cutoff = Date.now() - this.idleTimeoutMs;
    const toClose: string[] = [];

    for (const [key, entry] of this.pools.entries()) {
      if (entry.refCount === 0 && entry.lastUsed < cutoff) {
        toClose.push(key);
      }
    }

    await Promise.all(toClose.map((slug) => this.closePool(slug)));
  }

  /** Builds the MySQL connection URI with the given database name. */
  private buildUri(dbName: string): string {
    try {
      const url = new URL(this.baseUri);
      // MySQL URIs use the pathname as the database name: mysql://host/dbname
      url.pathname = `/${dbName}`;
      return url.toString();
    } catch {
      // Fallback for non-standard URIs: replace trailing path segment.
      const base = this.baseUri.replace(/\/[^/?]*(\?|$)/, `/${dbName}$1`);
      return base;
    }
  }
}
