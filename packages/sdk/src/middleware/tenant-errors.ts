import {
  ForbiddenError,
  TenantArchivedError,
  TenantNotFoundError,
  TenantSuspendedError,
} from "@stratum-hq/core";

export interface TenantErrorResponse {
  status: number;
  body: { error: { code: string; message: string } };
}

/**
 * Return the HTTP response for a tenant resolution error, or null when the
 * error is not a known tenant error. The adapters send this response instead
 * of passing the error on, where it would become a 500.
 */
export function tenantErrorResponse(err: unknown, tenantId: string): TenantErrorResponse | null {
  if (err instanceof TenantNotFoundError) {
    return { status: 404, body: { error: { code: "TENANT_NOT_FOUND", message: `Tenant not found: ${tenantId}` } } };
  }
  if (err instanceof TenantSuspendedError) {
    return { status: 403, body: { error: { code: "TENANT_SUSPENDED", message: `Tenant ${tenantId} is suspended` } } };
  }
  if (err instanceof TenantArchivedError) {
    return { status: 410, body: { error: { code: "TENANT_ARCHIVED", message: `Tenant ${tenantId} is archived` } } };
  }
  if (err instanceof ForbiddenError) {
    return { status: 403, body: { error: { code: "FORBIDDEN", message: `Access to tenant ${tenantId} is denied` } } };
  }
  return null;
}
