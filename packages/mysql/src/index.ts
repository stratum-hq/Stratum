// Types
export type {
  MysqlConnectionLike,
  MysqlPoolLike,
  MysqlAdapter,
  PurgeResult,
  AdapterStats,
  MysqlSharedAdapterOptions,
  MysqlTableAdapterOptions,
  MysqlDatabaseAdapterOptions,
  MysqlPoolManagerOptions,
} from "./types.js";

// Adapters
export { MysqlSharedAdapter } from "./adapters/shared.js";
export { MysqlTableAdapter } from "./adapters/table.js";
export { MysqlDatabaseAdapter } from "./adapters/database.js";

// Pool manager
export { MysqlPoolManager } from "./pool-manager.js";

// Views
export { createTenantView, dropTenantView, setTenantSession } from "./views/manager.js";

// Integrations
export { StratumTypeOrmSubscriber } from "./integrations/typeorm-subscriber.js";
export type { InsertEvent, EntitySubscriberInterface } from "./integrations/typeorm-subscriber.js";
export { withTenantScope } from "./integrations/knex.js";
export type { KnexLike, KnexQueryBuilderLike } from "./integrations/knex.js";
export { withMysqlTenantScope } from "./integrations/sequelize.js";
export type { SequelizeLike } from "./integrations/sequelize.js";

// Utilities
export { assertTenantId, escapeIdentifier, aggregatePurgeResults } from "./utils.js";
