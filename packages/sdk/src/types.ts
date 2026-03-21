import type { TenantContextLegacy, TenantNode, CreateTenantInput, UpdateTenantInput, MoveTenantInput, ResolvedPermission } from "@stratum-hq/core";

export type { TenantContextLegacy, TenantNode, CreateTenantInput, UpdateTenantInput, MoveTenantInput, ResolvedPermission };

export type { TenantResolver } from "./resolvers/custom.js";

export interface MiddlewareOptions {
  resolvers?: import("./resolvers/custom.js").TenantResolver[];
  headerName?: string;
  jwtClaimPath?: string;
  jwtSecret?: string;
  jwtVerify?: (token: string) => Record<string, unknown> | null;
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
