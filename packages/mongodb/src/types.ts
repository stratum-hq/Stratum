// ─── Structural types for MongoDB (no hard dependency on mongodb driver) ───

export interface MongoClientLike {
  db(name?: string): DatabaseLike;
  close(): Promise<void>;
}

export interface DatabaseLike {
  collection(name: string): CollectionLike;
  collections(): Promise<CollectionLike[]>;
  dropDatabase(): Promise<void>;
  listCollections(): { toArray(): Promise<Array<{ name: string }>> };
}

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
  bulkWrite(operations: unknown[]): Promise<unknown>;
  createIndex(spec: Record<string, unknown>, options?: unknown): Promise<string>;
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
}

export interface MongoDatabaseAdapterOptions {
  /** Factory function to create a new MongoClient for a connection URI. */
  createClient: (uri: string) => MongoClientLike | Promise<MongoClientLike>;
  /** Base connection URI (database name will be replaced per-tenant). */
  baseUri: string;
  /** Pool manager options. */
  maxClients?: number;
  idleTimeoutMs?: number;
}

export interface MongoPoolManagerOptions {
  /** Factory function to create a new MongoClient for a connection URI. */
  createClient: (uri: string) => MongoClientLike | Promise<MongoClientLike>;
  /** Base connection URI. */
  baseUri: string;
  /** Maximum number of cached clients. Default: 20. */
  maxClients?: number;
  /** Idle timeout in milliseconds. Default: 60000. */
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
