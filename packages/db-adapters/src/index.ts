export { BaseAdapter } from "./base-adapter.js";

export { RawAdapter, createTenantPool } from "./adapters/raw.js";
export { PrismaAdapter, withTenant } from "./adapters/prisma.js";
export {
  SchemaRawAdapter,
  createSchemaTenantPool,
} from "./adapters/schema-raw.js";
export {
  SchemaPrismaAdapter,
  withSchemaTenant,
} from "./adapters/schema-prisma.js";

export {
  createPolicy,
  dropPolicy,
  enableRLS,
  disableRLS,
  isRLSEnabled,
} from "./rls/manager.js";

export {
  setTenantContext,
  resetTenantContext,
  getCurrentTenantId,
} from "./rls/session.js";

export {
  createSchema,
  dropSchema,
  schemaExists,
  listTenantSchemas,
  replicateTableToSchema,
  tenantSchemaName,
} from "./schema/manager.js";

export {
  setSchemaSearchPath,
  resetSearchPath,
  getCurrentSearchPath,
} from "./schema/session.js";

export {
  addTenantColumn,
  enableRLS as enableRLSMigration,
  createIsolationPolicy,
  migrateTable,
} from "./migration-helpers.js";

// DB_PER_TENANT isolation
export {
  getDatabaseName,
  databaseExists,
  createDatabase,
  dropDatabase,
} from "./database/manager.js";

export { DatabasePoolManager } from "./database/pool-manager.js";
export type { DatabasePoolManagerOptions } from "./database/pool-manager.js";

export { DatabaseRawAdapter } from "./adapters/database-raw.js";
export { DatabasePrismaAdapter } from "./adapters/database-prisma.js";
export { SequelizeAdapter, withTenantScope } from "./adapters/sequelize.js";
export {
  DrizzleAdapter,
  withTenantScope as withDrizzleTenantScope,
} from "./adapters/drizzle.js";
export type { DrizzleLike } from "./adapters/drizzle.js";
