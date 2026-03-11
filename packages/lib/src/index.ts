export { Stratum, type StratumOptions } from "./stratum.js";
export { withClient, withTransaction } from "./pool-helpers.js";

// Re-export core types for convenience
export type {
  TenantNode,
  TenantContext,
  CreateTenantInput,
  UpdateTenantInput,
  MoveTenantInput,
  PaginationInput,
  PaginatedResult,
  ConfigEntry,
  SetConfigInput,
  ResolvedConfigEntry,
  ResolvedConfig,
  PermissionPolicy,
  CreatePermissionInput,
  UpdatePermissionInput,
  ResolvedPermission,
} from "@stratum/core";

export type { ApiKeyRecord, CreatedApiKey } from "./services/api-key-service.js";

// Re-export audit types for convenience
export type { AuditContext, AuditEntry, AuditLogQuery } from "@stratum/core";
