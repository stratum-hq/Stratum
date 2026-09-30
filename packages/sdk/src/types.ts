import type { ResolvedTenantContext, TenantNode, CreateTenantInput, UpdateTenantInput, MoveTenantInput, ResolvedPermission } from "@stratum-hq/core";

export type { ResolvedTenantContext, TenantNode, CreateTenantInput, UpdateTenantInput, MoveTenantInput, ResolvedPermission };

export type { TenantResolver } from "./resolvers/custom.js";

export interface MiddlewareOptions {
  resolvers?: import("./resolvers/custom.js").TenantResolver[];
  /** Header to read the tenant ID from. When set, only this header is read (default: X-Tenant-ID). */
  headerName?: string;
  jwtClaimPath?: string;
  /** HS256 secret for JWT verification. Requires the optional `jsonwebtoken` peer dependency unless `jwtVerify` is given. */
  jwtSecret?: string;
  jwtVerify?: (token: string) => Record<string, unknown> | null;
  /**
   * When set, a verified token is accepted only if its `aud` claim equals this
   * value (or, for an array, includes it). A token that fails the check is
   * rejected with 401. Applies to both `jwtSecret` and `jwtVerify`.
   */
  jwtAudience?: string;
  /** When set, a verified token is accepted only if its `iss` claim equals this value. */
  jwtIssuer?: string;
  /**
   * When `jwtSecret` or `jwtVerify` is configured, the tenant header is ignored
   * unless this is true, so the verified JWT is the only tenant binding. A
   * bearer token that fails verification is always rejected with 401. Has no
   * effect when JWT verification is not configured. Default: false.
   */
  trustTenantHeader?: boolean;
  onError?: (err: Error, req: unknown) => void;
  /**
   * Enable tenant impersonation via X-Impersonate-Tenant header.
   * When a request includes this header, the middleware resolves the
   * impersonated tenant's context instead of the caller's own.
   *
   * Provide a function that checks whether the current request is
   * authorized to impersonate (e.g., check for admin role/scope).
   * Return true to allow, false to deny.
   */
  impersonation?: {
    enabled: boolean;
    headerName?: string; // default: "X-Impersonate-Tenant"
    authorize: (req: unknown, callerTenantId: string, targetTenantId: string) => boolean | Promise<boolean>;
    onImpersonate?: (req: unknown, callerTenantId: string, targetTenantId: string) => void;
  };
}
