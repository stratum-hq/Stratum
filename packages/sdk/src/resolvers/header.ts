import { TENANT_HEADER } from "@stratum-hq/core";

/**
 * Read the tenant ID from a request header. When `headerName` is given, only
 * that header is read; otherwise the default X-Tenant-ID header is used.
 */
export function resolveFromHeader(req: unknown, headerName?: string): string | null {
  const r = req as Record<string, unknown>;
  const headers = r["headers"] as Record<string, string | string[] | undefined> | undefined;
  if (!headers) return null;
  const value = headerName
    ? headers[headerName.toLowerCase()]
    : headers[TENANT_HEADER.toLowerCase()] ?? headers[TENANT_HEADER];
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}
