// Consent types
export {
  ConsentPurpose,
  ConsentRecordSchema,
  GrantConsentInputSchema,
  type ConsentRecord,
  type GrantConsentInput,
} from "./types/consent.js";

// API Key types
export {
  API_KEY_SCOPES,
  ApiKeyScopeSchema,
  type ApiKeyScope,
} from "./types/api-key.js";

// Audit types
export {
  AuditEntrySchema,
  AuditLogQuerySchema,
  type AuditContext,
  type AuditEntry,
  type AuditLogQuery,
} from "./types/audit.js";

// Webhook types
export {
  TenantEvent,
  WebhookSchema,
  CreateWebhookInputSchema,
  UpdateWebhookInputSchema,
  WebhookEventSchema,
  WebhookDeliveryStatus,
  WebhookDeliverySchema,
  type Webhook,
  type CreateWebhookInput,
  type UpdateWebhookInput,
  type WebhookEvent,
  type WebhookDelivery,
} from "./types/webhook.js";

// Region types
export {
  RegionStatus,
  RegionSchema,
  CreateRegionInputSchema,
  UpdateRegionInputSchema,
  MigrateRegionInputSchema,
  type Region,
  type CreateRegionInput,
  type UpdateRegionInput,
  type MigrateRegionInput,
} from "./types/region.js";

// Types
export {
  IsolationStrategy,
  TenantStatus,
  TenantNodeSchema,
  CreateTenantInputSchema,
  UpdateTenantInputSchema,
  MoveTenantInputSchema,
  type TenantNode,
  type CreateTenantInput,
  type UpdateTenantInput,
  type MoveTenantInput,
  type TenantContext,
  type ResolvedPermission,
} from "./types/tenant.js";

export {
  PermissionMode,
  RevocationMode,
  PermissionPolicySchema,
  CreatePermissionInputSchema,
  UpdatePermissionInputSchema,
  type PermissionPolicy,
  type CreatePermissionInput,
  type UpdatePermissionInput,
} from "./types/permission.js";

export {
  ConfigEntrySchema,
  SetConfigInputSchema,
  type ConfigEntry,
  type SetConfigInput,
  type ResolvedConfigEntry,
  type ResolvedConfig,
  type BatchSetConfigKeyResult,
  type BatchSetConfigResult,
} from "./types/config.js";

export {
  SUPPORTED_ISOLATION_STRATEGIES_V1,
  isSupportedIsolationStrategy,
} from "./types/isolation.js";

// Utilities
export {
  parseAncestryPath,
  buildAncestryPath,
  getDepth,
  isAncestorOf,
  isDescendantOf,
  getParentPath,
  appendToPath,
  getAncestorIds,
  getSelfId,
} from "./utils/ancestry.js";

export {
  SlugSchema,
  UUIDSchema,
  PaginationSchema,
  validateSlug,
  type PaginationInput,
  type PaginatedResult,
} from "./utils/validation.js";

// Errors
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
} from "./utils/errors.js";

// Constants
export {
  MAX_TREE_DEPTH,
  MAX_SLUG_LENGTH,
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  API_KEY_PREFIX,
  API_KEY_BYTES,
  TENANT_HEADER,
} from "./constants.js";
