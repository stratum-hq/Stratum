export { Stratum, type StratumOptions } from "./stratum.js";
export { migrate, type MigrateOptions } from "./migrate.js";
export {
  migrateAllSchemas,
  type MigrateSchemasOptions,
  type MigrateSchemasResult,
} from "./migrate-schemas.js";
export { withClient, withTransaction } from "./pool-helpers.js";
export {
  verifyWebhookSignature,
  signWebhookPayload,
  DEFAULT_WEBHOOK_TOLERANCE_SECONDS,
  type VerifyWebhookOptions,
} from "./webhook-signature.js";
export { traced, getTracer, isTracingEnabled } from "./telemetry.js";

// Re-export core error classes as runtime VALUES (not `export type`) so consumers
// can branch with `instanceof` instead of matching error-message substrings. A
// type-only re-export would erase these at compile time and break instanceof.
export {
  ErrorCode,
  StratumError,
  TenantNotFoundError,
  TenantAlreadyExistsError,
  TenantHasChildrenError,
  TenantCycleDetectedError,
  TenantArchivedError,
  TenantContextNotFoundError,
  IsolationViolationError,
  IsolationStrategyUnsupportedError,
  PermissionLockedError,
  PermissionNotFoundError,
  PermissionRevocationDeniedError,
  ConfigLockedError,
  ConfigNotFoundError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  WebhookNotFoundError,
  WebhookDeliveryError,
  AbacPolicyNotFoundError,
  InvalidAbacOperatorError,
  AbacPolicyLockedError,
} from "@stratum-hq/core";

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

export { RateLimiter, MemoryRateLimitStore } from "./services/rate-limit-service.js";
export type {
  RateLimit,
  RateLimitResult,
  RateLimitState,
  RateLimitStore,
  RateLimitResolver,
  RateLimiterOptions,
} from "./services/rate-limit-service.js";

export type { ApiKeyRecord, CreatedApiKey, ValidatedApiKey, CreateApiKeyOptions } from "./services/api-key-service.js";
export type { BatchCreateResult } from "./services/tenant-service.js";
export type { KeyRotationResult } from "./services/key-rotation-service.js";
export type { DeliveryStats } from "./services/event-service.js";
export type { Role, CreateRoleInput, UpdateRoleInput } from "./services/role-service.js";

// Re-export audit types for convenience
export type { AuditContext, AuditEntry, AuditLogQuery } from "@stratum-hq/core";

export { defaultLogger, noopLogger } from "./logger.js";
export type { StratumLogger } from "./logger.js";
