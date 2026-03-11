import { TENANT_HEADER } from "@stratum/core";

export function resolveFromHeader(req: unknown): string | null {
  const r = req as Record<string, unknown>;
  const headers = r["headers"] as Record<string, string | string[] | undefined> | undefined;
  if (!headers) return null;
  const value = headers[TENANT_HEADER.toLowerCase()] ?? headers[TENANT_HEADER];
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}
