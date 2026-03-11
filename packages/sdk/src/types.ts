import type { TenantContext, TenantNode, CreateTenantInput, UpdateTenantInput, MoveTenantInput, ResolvedPermission } from "@stratum/core";

export type { TenantContext, TenantNode, CreateTenantInput, UpdateTenantInput, MoveTenantInput, ResolvedPermission };

export type { TenantResolver } from "./resolvers/custom.js";

export interface MiddlewareOptions {
  resolvers?: import("./resolvers/custom.js").TenantResolver[];
  headerName?: string;
  jwtClaimPath?: string;
  jwtSecret?: string;
  jwtVerify?: (token: string) => Record<string, unknown> | null;
  onError?: (err: Error, req: unknown) => void;
}
