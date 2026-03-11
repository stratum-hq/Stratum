export { BaseAdapter } from "./base-adapter.js";

export { RawAdapter, createTenantPool } from "./adapters/raw.js";
export { PrismaAdapter, withTenant } from "./adapters/prisma.js";

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
  addTenantColumn,
  enableRLS as enableRLSMigration,
  createIsolationPolicy,
  migrateTable,
} from "./migration-helpers.js";
