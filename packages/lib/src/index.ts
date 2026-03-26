export { Stratum, type StratumOptions } from "./stratum.js";
export { withClient, withTransaction } from "./pool-helpers.js";
export { traced, getTracer, isTracingEnabled } from "./telemetry.js";

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
} from "@stratum-hq/core";

export type { ApiKeyRecord, CreatedApiKey, ValidatedApiKey, CreateApiKeyOptions } from "./services/api-key-service.js";
export type { BatchCreateResult } from "./services/tenant-service.js";
export type { KeyRotationResult } from "./services/key-rotation-service.js";
export type { DeliveryStats } from "./services/event-service.js";
export type { Role, CreateRoleInput, UpdateRoleInput } from "./services/role-service.js";

// Re-export audit types for convenience
export type { AuditContext, AuditEntry, AuditLogQuery } from "@stratum-hq/core";

export { defaultLogger, noopLogger } from "./logger.js";
export type { StratumLogger } from "./logger.js";
