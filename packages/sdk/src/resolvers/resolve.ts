import type { MiddlewareOptions } from "../types.js";
import { resolveJwtTenant } from "./jwt.js";
import { resolveFromHeader } from "./header.js";

/**
 * Outcome of request tenant resolution. `invalid_token` means a bearer token
 * was sent while JWT verification is configured and it did not verify; the
 * caller must reject the request rather than try other sources.
 */
export type TenantIdResolution =
  | { status: "resolved"; tenantId: string }
  | { status: "missing" }
  | { status: "invalid_token" };

/**
 * Resolve the tenant ID for a request: verified JWT, then the tenant header,
 * then custom resolvers.
 *
 * When `jwtSecret` or `jwtVerify` is configured, the JWT is the tenant binding:
 * a token that fails verification is reported as `invalid_token`, and the
 * client-supplied tenant header is not consulted unless `trustTenantHeader`
 * is true.
 */
export async function resolveTenantId(req: unknown, options?: MiddlewareOptions): Promise<TenantIdResolution> {
  const jwtConfigured = Boolean(options?.jwtSecret || options?.jwtVerify);

  const jwt = resolveJwtTenant(req, options?.jwtClaimPath, {
    secret: options?.jwtSecret,
    verify: options?.jwtVerify,
  });
  if (jwt.status === "resolved") return { status: "resolved", tenantId: jwt.tenantId };
  if (jwt.status === "invalid") return { status: "invalid_token" };

  if (!jwtConfigured || options?.trustTenantHeader) {
    const fromHeader = resolveFromHeader(req, options?.headerName);
    if (fromHeader) return { status: "resolved", tenantId: fromHeader };
  }

  if (options?.resolvers) {
    for (const resolver of options.resolvers) {
      const result = await resolver.resolve(req);
      if (result) return { status: "resolved", tenantId: result };
    }
  }

  return { status: "missing" };
}
