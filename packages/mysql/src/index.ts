// Types
export type {
  MysqlConnectionLike,
  MysqlExecuteValue,
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
export {
  StratumTypeOrmSubscriber,
  registerStratumSubscriber,
} from "./integrations/typeorm-subscriber.js";
export type {
  InsertEvent,
  UpdateEvent,
  BeforeQueryEvent,
  EntitySubscriberInterface,
  TypeOrmDataSourceLike,
} from "./integrations/typeorm-subscriber.js";
export { withTenantScope } from "./integrations/knex.js";
export type { KnexLike, KnexQueryBuilderLike } from "./integrations/knex.js";
export { withMysqlTenantScope } from "./integrations/sequelize.js";
export type { SequelizeLike } from "./integrations/sequelize.js";

// Utilities
export { assertTenantId, escapeIdentifier, aggregatePurgeResults } from "./utils.js";
