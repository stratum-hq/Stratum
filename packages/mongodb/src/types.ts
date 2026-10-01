// ─── Structural types for MongoDB (no hard dependency on mongodb driver) ───

export interface MongoClientLike {
  db(name?: string): DatabaseLike;
  close(): Promise<void>;
}

export interface DatabaseLike {
  collection(name: string): CollectionLike;
  collections(): Promise<CollectionLike[]>;
  dropDatabase(): Promise<unknown>;
  listCollections(): { toArray(): Promise<Array<{ name: string }>> };
}

/**
 * An index key direction or index type, as the mongodb driver's
 * `IndexDirection` declares it. A wider value type here would make a driver
 * collection unassignable to CollectionLike.
 */
export type MongoIndexDirection = number | "2d" | "2dsphere" | "text" | "geoHaystack" | "hashed";

export interface CollectionLike {
  collectionName?: string;
  find(filter?: Record<string, unknown>, options?: unknown): { toArray(): Promise<unknown[]> };
  findOne(filter?: Record<string, unknown>): Promise<unknown>;
  insertOne(doc: Record<string, unknown>): Promise<{ insertedId: unknown }>;
  insertMany(docs: Record<string, unknown>[]): Promise<{ insertedIds: Record<number, unknown> }>;
  updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options?: unknown): Promise<{ modifiedCount: number }>;
  updateMany(filter: Record<string, unknown>, update: Record<string, unknown>, options?: unknown): Promise<{ modifiedCount: number }>;
  deleteOne(filter: Record<string, unknown>): Promise<{ deletedCount: number }>;
  deleteMany(filter: Record<string, unknown>): Promise<{ deletedCount: number }>;
  aggregate(pipeline: Record<string, unknown>[]): { toArray(): Promise<unknown[]> };
  countDocuments(filter?: Record<string, unknown>): Promise<number>;
  distinct(field: string, filter?: Record<string, unknown>): Promise<unknown[]>;
  bulkWrite(operations: readonly unknown[]): Promise<unknown>;
  createIndex(spec: Record<string, MongoIndexDirection>, options?: unknown): Promise<string>;
}

// ─── Adapter interface ───

export interface MongoAdapter {
  purgeTenantData(tenantId: string): Promise<PurgeResult>;
  getStats(): AdapterStats;
}

export interface PurgeResult {
  success: boolean;
  collectionsProcessed: number;
  documentsDeleted: number;
  errors: Array<{ collection: string; error: Error }>;
}

export interface AdapterStats {
  strategy: string;
  [key: string]: unknown;
}

// ─── Options ───

export interface MongoSharedAdapterOptions {
  /** The MongoClientLike instance to use. */
  client: MongoClientLike;
  /** The database name to use. */
  databaseName: string;
}

export interface MongoCollectionAdapterOptions {
  /** The MongoClientLike instance to use. */
  client: MongoClientLike;
  /** The database name to use. */
  databaseName: string;
  /**
   * Every base collection name that has a per-tenant copy. Required by
   * scopedCollection, which only accepts these base names, and by
   * purgeTenantData, which purges exactly `{base}_{slug}` for each entry and
   * nothing else.
   * No entry may be another entry followed by `_`, since `{base}_{slug}` would
   * then be ambiguous between two tenants.
   */
  baseCollections?: string[];
}

export interface MongoDatabaseAdapterOptions {
  /** Factory function to create a new MongoClient for a connection URI. */
  createClient: (uri: string) => MongoClientLike | Promise<MongoClientLike>;
  /** Base connection URI (database name will be replaced per-tenant). */
  baseUri: string;
  /** Maximum number of cached clients. Default: 20. */
  maxClients?: number;
  /**
   * Milliseconds a client that no caller holds can stay unused before the
   * manager closes it. The manager also checks at this interval, capped at
   * 2^31 - 1. `0` or `Infinity` turns the idle check off. A negative value or
   * NaN throws a RangeError. Default: 60000.
   */
  idleTimeoutMs?: number;
}

export interface MongoPoolManagerOptions {
  /** Factory function to create a new MongoClient for a connection URI. */
  createClient: (uri: string) => MongoClientLike | Promise<MongoClientLike>;
  /** Base connection URI. */
  baseUri: string;
  /** Maximum number of cached clients. Default: 20. */
  maxClients?: number;
  /**
   * Milliseconds a client that no caller holds can stay unused before the
   * manager closes it. The manager also checks at this interval, capped at
   * 2^31 - 1. `0` or `Infinity` turns the idle check off. A negative value or
   * NaN throws a RangeError. Default: 60000.
   */
  idleTimeoutMs?: number;
}

/** Methods allowed on the tenant-scoped collection proxy. */
export const ALLOWED_PROXY_METHODS = [
  "find",
  "findOne",
  "insertOne",
  "insertMany",
  "updateOne",
  "updateMany",
  "deleteOne",
  "deleteMany",
  "aggregate",
  "countDocuments",
  "distinct",
  "bulkWrite",
  "createIndex",
] as const;

export type AllowedProxyMethod = (typeof ALLOWED_PROXY_METHODS)[number];
