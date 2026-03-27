export enum ErrorCode {
  ABAC_POLICY_NOT_FOUND = "ABAC_POLICY_NOT_FOUND",
  INVALID_ABAC_OPERATOR = "INVALID_ABAC_OPERATOR",
  TENANT_NOT_FOUND = "TENANT_NOT_FOUND",
  TENANT_ALREADY_EXISTS = "TENANT_ALREADY_EXISTS",
  TENANT_HAS_CHILDREN = "TENANT_HAS_CHILDREN",
  TENANT_CYCLE_DETECTED = "TENANT_CYCLE_DETECTED",
  TENANT_ARCHIVED = "TENANT_ARCHIVED",
  TENANT_CONTEXT_NOT_FOUND = "TENANT_CONTEXT_NOT_FOUND",
  ISOLATION_VIOLATION = "ISOLATION_VIOLATION",
  ISOLATION_STRATEGY_UNSUPPORTED = "ISOLATION_STRATEGY_UNSUPPORTED",
  PERMISSION_LOCKED = "PERMISSION_LOCKED",
  PERMISSION_NOT_FOUND = "PERMISSION_NOT_FOUND",
  PERMISSION_REVOCATION_DENIED = "PERMISSION_REVOCATION_DENIED",
  CONFIG_LOCKED = "CONFIG_LOCKED",
  CONFIG_NOT_FOUND = "CONFIG_NOT_FOUND",
  VALIDATION_ERROR = "VALIDATION_ERROR",
  UNAUTHORIZED = "UNAUTHORIZED",
  FORBIDDEN = "FORBIDDEN",
  WEBHOOK_NOT_FOUND = "WEBHOOK_NOT_FOUND",
  WEBHOOK_DELIVERY_FAILED = "WEBHOOK_DELIVERY_FAILED",
}

export class StratumError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    statusCode: number = 500,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "StratumError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

export class TenantNotFoundError extends StratumError {
  constructor(tenantId: string) {
    super(
      ErrorCode.TENANT_NOT_FOUND,
      `Tenant not found: ${tenantId}`,
      404,
    );
    this.name = "TenantNotFoundError";
  }
}

export class TenantAlreadyExistsError extends StratumError {
  constructor(slug: string) {
    super(
      ErrorCode.TENANT_ALREADY_EXISTS,
      `Tenant with slug '${slug}' already exists`,
      409,
    );
    this.name = "TenantAlreadyExistsError";
  }
}

export class TenantHasChildrenError extends StratumError {
  constructor(tenantId: string) {
    super(
      ErrorCode.TENANT_HAS_CHILDREN,
      `Cannot archive tenant ${tenantId}: it has active children. Archive children first.`,
      409,
    );
    this.name = "TenantHasChildrenError";
  }
}

export class TenantCycleDetectedError extends StratumError {
  constructor(tenantId: string, newParentId: string) {
    super(
      ErrorCode.TENANT_CYCLE_DETECTED,
      `Moving tenant ${tenantId} under ${newParentId} would create a cycle`,
      409,
    );
    this.name = "TenantCycleDetectedError";
  }
}

export class TenantArchivedError extends StratumError {
  constructor(tenantId: string) {
    super(
      ErrorCode.TENANT_ARCHIVED,
      `Tenant ${tenantId} is archived`,
      410,
    );
    this.name = "TenantArchivedError";
  }
}

export class TenantContextNotFoundError extends StratumError {
  constructor() {
    super(
      ErrorCode.TENANT_CONTEXT_NOT_FOUND,
      "getTenantContext() called outside of a request context. Ensure Stratum middleware is installed and the call is within a request handler.",
      500,
    );
    this.name = "TenantContextNotFoundError";
  }
}

export class IsolationViolationError extends StratumError {
  constructor(message: string) {
    super(ErrorCode.ISOLATION_VIOLATION, message, 403);
    this.name = "IsolationViolationError";
  }
}

export class IsolationStrategyUnsupportedError extends StratumError {
  constructor(strategy: string) {
    super(
      ErrorCode.ISOLATION_STRATEGY_UNSUPPORTED,
      `Isolation strategy '${strategy}' is not supported in v1. Only SHARED_RLS is available.`,
      400,
    );
    this.name = "IsolationStrategyUnsupportedError";
  }
}

export class PermissionLockedError extends StratumError {
  constructor(key: string, sourceTenantId: string) {
    super(
      ErrorCode.PERMISSION_LOCKED,
      `Permission '${key}' is LOCKED by tenant ${sourceTenantId} and cannot be overridden`,
      403,
      { key, source_tenant_id: sourceTenantId },
    );
    this.name = "PermissionLockedError";
  }
}

export class PermissionNotFoundError extends StratumError {
  constructor(policyId: string) {
    super(
      ErrorCode.PERMISSION_NOT_FOUND,
      `Permission policy not found: ${policyId}`,
      404,
    );
    this.name = "PermissionNotFoundError";
  }
}

export class PermissionRevocationDeniedError extends StratumError {
  constructor(key: string) {
    super(
      ErrorCode.PERMISSION_REVOCATION_DENIED,
      `Permission '${key}' has PERMANENT revocation mode and cannot be revoked`,
      403,
    );
    this.name = "PermissionRevocationDeniedError";
  }
}

export class ConfigLockedError extends StratumError {
  constructor(key: string, sourceTenantId: string) {
    super(
      ErrorCode.CONFIG_LOCKED,
      `Config '${key}' is locked by tenant ${sourceTenantId} and cannot be overridden`,
      403,
      { key, source_tenant_id: sourceTenantId },
    );
    this.name = "ConfigLockedError";
  }
}

export class ConfigNotFoundError extends StratumError {
  constructor(tenantId: string, key: string) {
    super(
      ErrorCode.CONFIG_NOT_FOUND,
      `Config key '${key}' not found for tenant ${tenantId}`,
      404,
    );
    this.name = "ConfigNotFoundError";
  }
}

export class ValidationError extends StratumError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(ErrorCode.VALIDATION_ERROR, message, 400, details);
    this.name = "ValidationError";
  }
}

export class UnauthorizedError extends StratumError {
  constructor(message: string = "Authentication required") {
    super(ErrorCode.UNAUTHORIZED, message, 401);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends StratumError {
  constructor(message: string = "Access denied") {
    super(ErrorCode.FORBIDDEN, message, 403);
    this.name = "ForbiddenError";
  }
}

export class WebhookNotFoundError extends StratumError {
  constructor(webhookId: string) {
    super(ErrorCode.WEBHOOK_NOT_FOUND, `Webhook not found: ${webhookId}`, 404);
    this.name = "WebhookNotFoundError";
  }
}

export class WebhookDeliveryError extends StratumError {
  constructor(webhookId: string, message: string) {
    super(
      ErrorCode.WEBHOOK_DELIVERY_FAILED,
      `Webhook delivery failed for ${webhookId}: ${message}`,
      500,
    );
    this.name = "WebhookDeliveryError";
  }
}

export class AbacPolicyNotFoundError extends StratumError {
  constructor(policyId: string) {
    super(
      ErrorCode.ABAC_POLICY_NOT_FOUND,
      `ABAC policy not found: ${policyId}`,
      404,
    );
    this.name = "AbacPolicyNotFoundError";
  }
}

export class InvalidAbacOperatorError extends StratumError {
  constructor(operator: string) {
    super(
      ErrorCode.INVALID_ABAC_OPERATOR,
      `Invalid ABAC operator: '${operator}'`,
      400,
    );
    this.name = "InvalidAbacOperatorError";
  }
}
