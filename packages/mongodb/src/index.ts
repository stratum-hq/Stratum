// Types
export type {
  MongoClientLike,
  DatabaseLike,
  CollectionLike,
  MongoAdapter,
  PurgeResult,
  AdapterStats,
  MongoSharedAdapterOptions,
  MongoCollectionAdapterOptions,
  MongoDatabaseAdapterOptions,
  MongoPoolManagerOptions,
  AllowedProxyMethod,
} from "./types.js";

export { ALLOWED_PROXY_METHODS } from "./types.js";

// Adapters
export { MongoSharedAdapter, createTenantScopedCollection } from "./adapters/shared.js";
export { MongoCollectionAdapter } from "./adapters/collection.js";
export { MongoDatabaseAdapter } from "./adapters/database.js";

// Pool manager
export { MongoPoolManager } from "./pool-manager.js";

// Mongoose plugin
export { stratumPlugin } from "./mongoose-plugin.js";

// Utilities
export { assertTenantId, aggregatePurgeResults, stripTenantIdFromUpdate, assertSafeAggregatePipeline } from "./utils.js";
