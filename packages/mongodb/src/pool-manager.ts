import { validateSlug } from "@stratum-hq/core";
import type { MongoClientLike, MongoPoolManagerOptions } from "./types.js";

/** The largest delay that setInterval accepts, 2^31 - 1 milliseconds. */
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

interface ClientEntry {
  /** Settles when the client exists. Concurrent first requests wait on the same promise. */
  ready: Promise<MongoClientLike>;
  lastUsed: number;
  /** Callers that received this client from getClient and have not called releaseClient. */
  refCount: number;
}

/**
 * Manages a collection of per-tenant MongoClient instances with LRU eviction.
 *
 * Clients are keyed by tenant slug and created on first access. Each getClient
 * call holds the client until the caller calls releaseClient. A held client is
 * never closed by eviction or by the idle check, so the count can exceed
 * maxClients while every client is in use.
 *
 * When the client count reaches maxClients, the least-recently-used client that
 * no caller holds is evicted. A background timer closes a client that no caller
 * holds after it stays unused for longer than idleTimeoutMs.
 */
export class MongoPoolManager {
  private readonly clients: Map<string, ClientEntry> = new Map();
  private readonly createClient: (uri: string) => MongoClientLike | Promise<MongoClientLike>;
  private readonly baseUri: string;
  private readonly maxClients: number;
  private readonly idleTimeoutMs: number;
  /** Undefined when idleTimeoutMs turns the idle check off. */
  private readonly idleTimer: ReturnType<typeof setInterval> | undefined;
  /** Clients that closeClient or closeAll removed while a caller held them, by slug. */
  private readonly closedEntries: Map<string, Set<ClientEntry>> = new Map();

  constructor(options: MongoPoolManagerOptions) {
    this.createClient = options.createClient;
    this.baseUri = options.baseUri;
    this.maxClients = options.maxClients ?? 20;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 60_000;

    if (Number.isNaN(this.idleTimeoutMs) || this.idleTimeoutMs < 0) {
      throw new RangeError(
        `idleTimeoutMs must be 0, a positive number, or Infinity; got ${this.idleTimeoutMs}`,
      );
    }
    if (this.idleTimeoutMs === 0 || this.idleTimeoutMs === Infinity) return;

    // Node.js runs a timer with a delay above MAX_TIMER_DELAY_MS after 1 ms,
    // so a longer timeout would run the idle check in a tight loop.
    this.idleTimer = setInterval(
      () => {
        void this.closeIdleClients();
      },
      Math.min(this.idleTimeoutMs, MAX_TIMER_DELAY_MS),
    );
    // The idle check must not keep the Node.js process alive.
    this.idleTimer.unref?.();
  }

  /**
   * Returns the MongoClient for the tenant slug, and creates it on first access.
   * Each call holds the client until the caller calls releaseClient. A held
   * client is never closed by eviction or by the idle check.
   */
  async getClient(slug: string): Promise<MongoClientLike> {
    validateSlug(slug);

    // The lookup, the eviction choice and the insert run with no await between
    // them. Thus a concurrent call for the same slug always finds this entry and
    // waits for the same client.
    let entry = this.clients.get(slug);
    if (!entry) {
      const victim = this.clients.size >= this.maxClients ? this.takeLRU() : undefined;
      entry = { ready: this.openClient(slug, victim), lastUsed: Date.now(), refCount: 0 };
      this.clients.set(slug, entry);
    }

    entry.lastUsed = Date.now();
    entry.refCount++;
    try {
      return await entry.ready;
    } catch (err) {
      // Remove the failed entry so that the next call tries again. The caller
      // gets no client, so it will not call releaseClient.
      if (this.clients.get(slug) === entry) this.clients.delete(slug);
      entry.refCount--;
      this.forgetClosedIfReleased(slug, entry);
      throw err;
    }
  }

  /**
   * Ends one hold on the client that getClient returned for the slug.
   * Call it once for each getClient call. No-op if the slug is not tracked.
   */
  releaseClient(slug: string): void {
    // The caller passes a slug, not the client, so the manager cannot tell a
    // hold on a closed client from a hold on its replacement. It ends holds on
    // closed clients first. The replacement then counts as held for longer
    // than it is, which is safe: eviction never closes a client in use.
    const closed = this.closedEntries.get(slug)?.values().next().value;
    if (closed) {
      closed.refCount--;
      this.forgetClosedIfReleased(slug, closed);
      return;
    }

    const entry = this.clients.get(slug);
    if (!entry || entry.refCount === 0) return;
    entry.refCount--;
    entry.lastUsed = Date.now();
  }

  /** Closes and removes the client for the given slug, held or not. No-op if not found. */
  async closeClient(slug: string): Promise<void> {
    const entry = this.clients.get(slug);
    if (!entry) return;
    this.clients.delete(slug);
    this.recordClosedHolds(slug, entry);
    await closeEntry(entry);
  }

  /** Closes all managed clients and stops the idle check. Call during application shutdown. */
  async closeAll(): Promise<void> {
    clearInterval(this.idleTimer);
    const entries = Array.from(this.clients.entries());
    this.clients.clear();
    for (const [slug, entry] of entries) this.recordClosedHolds(slug, entry);
    await Promise.all(entries.map(([, entry]) => closeEntry(entry)));
  }

  /** Returns a snapshot of current pool statistics. */
  getStats(): { clientCount: number } {
    return { clientCount: this.clients.size };
  }

  /** Closes the evicted client first, then creates the client for the slug. */
  private async openClient(slug: string, victim: ClientEntry | undefined): Promise<MongoClientLike> {
    // The evicted client belongs to a different tenant. Its close error must
    // not fail this request.
    if (victim) await closeEntry(victim).catch(() => undefined);
    return this.createClient(this.buildUri(`stratum_tenant_${slug}`));
  }

  /** Keeps a removed client that callers still hold, so that their releases do not reach a later client for the slug. */
  private recordClosedHolds(slug: string, entry: ClientEntry): void {
    if (entry.refCount === 0) return;
    let closed = this.closedEntries.get(slug);
    if (!closed) {
      closed = new Set();
      this.closedEntries.set(slug, closed);
    }
    closed.add(entry);
  }

  /** Stops tracking a removed client after its last hold ends. */
  private forgetClosedIfReleased(slug: string, entry: ClientEntry): void {
    const closed = this.closedEntries.get(slug);
    if (!closed || entry.refCount > 0) return;
    closed.delete(entry);
    if (closed.size === 0) this.closedEntries.delete(slug);
  }

  /**
   * Removes the least-recently-used client that no caller holds from the map
   * and returns its entry. The caller closes it. Returns undefined when every
   * client is held.
   */
  private takeLRU(): ClientEntry | undefined {
    let oldestKey: string | undefined;
    let oldestTime = Infinity;

    for (const [key, entry] of this.clients.entries()) {
      if (entry.refCount === 0 && entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed;
        oldestKey = key;
      }
    }

    if (oldestKey === undefined) return undefined;
    const entry = this.clients.get(oldestKey)!;
    this.clients.delete(oldestKey);
    return entry;
  }

  /** Closes each client that no caller holds and that stayed unused longer than idleTimeoutMs. */
  private async closeIdleClients(): Promise<void> {
    const cutoff = Date.now() - this.idleTimeoutMs;
    const idle: ClientEntry[] = [];
    for (const [key, entry] of this.clients.entries()) {
      if (entry.refCount === 0 && entry.lastUsed < cutoff) {
        this.clients.delete(key);
        idle.push(entry);
      }
    }
    // The timer discards this promise, so a rejection here would be unhandled.
    await Promise.allSettled(idle.map(closeEntry));
  }

  /** Builds the MongoDB connection URI with the given database name. */
  private buildUri(dbName: string): string {
    try {
      const url = new URL(this.baseUri);
      url.pathname = `/${dbName}`;
      return url.toString();
    } catch {
      // Fallback for non-standard URIs: simple string replacement
      const base = this.baseUri.replace(/\/[^/?]*(\?|$)/, `/${dbName}$1`);
      return base;
    }
  }
}

/** Closes the entry's client. A client that failed to be created has nothing to close. */
async function closeEntry(entry: ClientEntry): Promise<void> {
  const client = await entry.ready.catch(() => undefined);
  await client?.close();
}
