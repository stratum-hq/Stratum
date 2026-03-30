import { validateSlug } from "@stratum-hq/core";
import type { MongoClientLike, MongoPoolManagerOptions } from "./types.js";

interface ClientEntry {
  client: MongoClientLike;
  lastUsed: number;
}

/**
 * Manages a collection of per-tenant MongoClient instances with LRU eviction.
 *
 * Clients are keyed by tenant slug and created on first access.
 * When the client count exceeds maxClients, the least-recently-used client is evicted.
 */
export class MongoPoolManager {
  private readonly clients: Map<string, ClientEntry> = new Map();
  private readonly createClient: (uri: string) => MongoClientLike | Promise<MongoClientLike>;
  private readonly baseUri: string;
  private readonly maxClients: number;

  constructor(options: MongoPoolManagerOptions) {
    this.createClient = options.createClient;
    this.baseUri = options.baseUri;
    this.maxClients = options.maxClients ?? 20;
  }

  /**
   * Returns a cached MongoClient for the given tenant slug, creating one if needed.
   * Evicts the LRU client if the pool is at capacity.
   */
  async getClient(slug: string): Promise<MongoClientLike> {
    validateSlug(slug);

    const existing = this.clients.get(slug);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing.client;
    }

    // Evict before adding so we never exceed maxClients.
    if (this.clients.size >= this.maxClients) {
      await this.evictLRU();
    }

    const dbName = `stratum_tenant_${slug}`;
    // Replace or append database name in the URI
    const uri = this.buildUri(dbName);
    const client = await this.createClient(uri);

    this.clients.set(slug, { client, lastUsed: Date.now() });
    return client;
  }

  /** Closes and removes the client for the given slug. No-op if not found. */
  async closeClient(slug: string): Promise<void> {
    const entry = this.clients.get(slug);
    if (!entry) return;
    this.clients.delete(slug);
    await entry.client.close();
  }

  /** Closes all managed clients. Call during application shutdown. */
  async closeAll(): Promise<void> {
    const entries = Array.from(this.clients.entries());
    this.clients.clear();
    await Promise.all(entries.map(([, entry]) => entry.client.close()));
  }

  /** Returns a snapshot of current pool statistics. */
  getStats(): { clientCount: number } {
    return { clientCount: this.clients.size };
  }

  /** Evicts the client that has been idle the longest. */
  private async evictLRU(): Promise<void> {
    let oldestKey: string | undefined;
    let oldestTime = Infinity;

    for (const [key, entry] of this.clients.entries()) {
      if (entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed;
        oldestKey = key;
      }
    }

    if (oldestKey !== undefined) {
      await this.closeClient(oldestKey);
    }
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
