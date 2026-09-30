import {
  ForbiddenError,
  TenantArchivedError,
  TenantNotFoundError,
  TenantSuspendedError,
  UnauthorizedError,
} from "@stratum-hq/core";

export interface TenantErrorResponse {
  status: number;
  body: { error: { code: string; message: string } };
}

/**
 * Return the HTTP response for a tenant resolution error, or null when the
 * error is not a known tenant error. The adapters send this response instead
 * of passing the error on, where it would become a 500. A tenant error is a
 * normal answer for the request, so the adapters do not call `onError` for it.
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

/**
 * Return the HTTP response for a control plane failure during tenant
 * resolution, or null for any other error.
 *
 * A timeout answers 504. A rejected SDK API key answers 500, because the
 * fault is in the server configuration and not in the request. For a rejected
 * key, this function also writes the cause to `console.error`, because the
 * response body does not show it.
 */
export function controlPlaneErrorResponse(err: unknown): TenantErrorResponse | null {
  if (err instanceof Error && err.name === "TimeoutError") {
    return {
      status: 504,
      body: { error: { code: "CONTROL_PLANE_TIMEOUT", message: "The Stratum control plane did not respond in time" } },
    };
  }
  if (err instanceof UnauthorizedError) {
    console.error(
      "[stratum] The control plane rejected the SDK API key (401). Check the apiKey option of StratumClient.",
    );
    return {
      status: 500,
      body: { error: { code: "CONTROL_PLANE_AUTH_FAILED", message: "Tenant resolution failed" } },
    };
  }
  return null;
}
