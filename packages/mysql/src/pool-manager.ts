import { validateSlug } from "@stratum-hq/core";
import type { MysqlPoolLike, MysqlPoolManagerOptions } from "./types.js";

interface PoolEntry {
  /** Settles when the pool exists. Concurrent first requests wait on the same promise. */
  ready: Promise<MysqlPoolLike>;
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

    // The lookup, the eviction choice and the insert run with no await between
    // them. Thus a concurrent call for the same slug always finds this entry and
    // waits for the same pool.
    let entry = this.pools.get(slug);
    if (!entry) {
      const victim = this.pools.size >= this.maxPools ? this.takeLRU() : undefined;
      entry = { ready: this.openPool(slug, victim), lastUsed: Date.now(), refCount: 0 };
      this.pools.set(slug, entry);
    }

    entry.lastUsed = Date.now();
    entry.refCount++;
    try {
      return await entry.ready;
    } catch (err) {
      // Remove the failed entry so that the next call tries again. The caller
      // gets no pool, so it will not call releasePool.
      if (this.pools.get(slug) === entry) this.pools.delete(slug);
      entry.refCount--;
      throw err;
    }
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
    await endEntry(entry);
  }

  /** Closes all managed pools and stops the idle timer. Call during application shutdown. */
  async closeAll(): Promise<void> {
    clearInterval(this.idleTimer);
    const entries = Array.from(this.pools.entries());
    this.pools.clear();
    await Promise.all(entries.map(([, entry]) => endEntry(entry)));
  }

  /** Returns a snapshot of current pool statistics. */
  getStats(): { poolCount: number } {
    return { poolCount: this.pools.size };
  }

  /** Ends the evicted pool first, then creates the pool for the slug. */
  private async openPool(slug: string, victim: PoolEntry | undefined): Promise<MysqlPoolLike> {
    // The evicted pool belongs to a different tenant. Its end error must not
    // fail this request.
    if (victim) await endEntry(victim).catch(() => undefined);
    return this.createPool(this.buildUri(`stratum_tenant_${slug}`));
  }

  /**
   * Removes the least-recently-used pool that no caller holds from the map and
   * returns its entry. The caller ends it. Returns undefined when every pool is held.
   */
  private takeLRU(): PoolEntry | undefined {
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
    return entry;
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

/** Ends the entry's pool. A pool that failed to be created has nothing to end. */
async function endEntry(entry: PoolEntry): Promise<void> {
  const pool = await entry.ready.catch(() => undefined);
  await pool?.end();
}
