import { FastifyRequest, FastifyReply, FastifyInstance } from "fastify";
import { ForbiddenError } from "@stratum-hq/core";
import { Stratum } from "@stratum-hq/lib";

/** Reads the target tenant id from a request, or null when there is none to check. */
export type TenantIdExtractor = (req: FastifyRequest) => string | null;

/**
 * A route's tenant-scope declaration:
 *  - an extractor: enforce that the caller's key may reach the extracted tenant;
 *  - "global": operator-level route with no single tenant target, or one that
 *    scopes itself in its handler. The middleware performs no tenant check.
 */
export type TenantScopeDeclaration = TenantIdExtractor | "global";

declare module "fastify" {
  interface FastifyContextConfig {
    tenantScope?: TenantScopeDeclaration;
  }
}

/**
 * Core tenant-scope check.
 *
 * Ensures that tenant-scoped API keys can only access data belonging to their
 * own tenant or its descendants in the hierarchy. Global keys (tenant_id ===
 * null) have unrestricted access.
 */
async function checkTenantScope(
  stratum: Stratum,
  request: FastifyRequest,
  extractTenantId: TenantIdExtractor,
): Promise<void> {
  const apiKey = request.apiKey;
  if (!apiKey) return;

  // Only API keys may have global (null tenant_id) access.
  // JWT auth should never reach here with null tenant_id after the auth middleware
  // fix, but guard defensively anyway.
  if (apiKey.tenant_id === null) {
    if (request.authMethod === "api_key") return;
    throw new ForbiddenError("JWT authentication requires a tenant scope");
  }

  const targetTenantId = extractTenantId(request);
  if (!targetTenantId) return;

  // Fast path: exact match
  if (apiKey.tenant_id === targetTenantId) return;

  // Hierarchy check: target must be a descendant of the key's tenant
  try {
    const target = await stratum.getTenant(targetTenantId);
    const ancestorIds = target.ancestry_path.split("/").filter(Boolean);
    if (ancestorIds.includes(apiKey.tenant_id)) return;
  } catch {
    // Tenant not found: fail closed for scoped keys
    throw new ForbiddenError(
      "API key tenant scope does not grant access to this tenant",
    );
  }

  throw new ForbiddenError(
    "API key tenant scope does not grant access to this tenant",
  );
}

/**
 * Tenant-scope enforcement middleware for a single extractor.
 *
 * Retained for routes that must authorize a second tenant beyond the one the
 * global enforcer already covers (for example, a move's destination parent).
 */
export function createTenantScopeGuard(
  stratum: Stratum,
  extractTenantId: TenantIdExtractor,
) {
  return async function tenantScopeGuard(
    request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> {
    await checkTenantScope(stratum, request, extractTenantId);
  };
}

/**
 * Authorize a single tenant CREATE against the caller's key scope.
 *
 * A scoped key may only create tenants within its own subtree, so the new
 * tenant's parent must be the key's own tenant or a descendant of it. A scoped
 * key may not create a new root (a tenant with no parent). Global (operator)
 * keys are unrestricted and may create roots anywhere.
 */
async function authorizeCreateUnder(
  stratum: Stratum,
  request: FastifyRequest,
  parentId: string | null,
): Promise<void> {
  const apiKey = request.apiKey;
  if (!apiKey) return;

  // Only global API keys (null tenant_id) may create roots or create anywhere.
  if (apiKey.tenant_id === null && request.authMethod === "api_key") return;

  if (!parentId) {
    throw new ForbiddenError(
      "API key tenant scope may not create root tenants",
    );
  }
  await checkTenantScope(stratum, request, () => parentId);
}

/**
 * Guard for POST /tenants: constrain a scoped key's new tenant to its subtree.
 */
export function createTenantCreateGuard(stratum: Stratum) {
  return async function tenantCreateGuard(
    request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> {
    const body = request.body as { parent_id?: string | null } | null;
    await authorizeCreateUnder(stratum, request, body?.parent_id ?? null);
  };
}

/**
 * Guard for POST /tenants/batch: every tenant in the batch is authorized the
 * same way a single create is, so the batch route cannot sidestep the subtree
 * constraint.
 */
export function createTenantBatchCreateGuard(stratum: Stratum) {
  return async function tenantBatchCreateGuard(
    request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> {
    const body = request.body as {
      tenants?: Array<{ parent_id?: string | null }>;
    } | null;
    const tenants = Array.isArray(body?.tenants) ? body.tenants : [];
    for (const tenant of tenants) {
      await authorizeCreateUnder(stratum, request, tenant?.parent_id ?? null);
    }
  };
}

// Endpoints that carry no authentication and therefore no tenant scope.
// Kept in step with the same skip list in the auth and authorize middleware.
function isUnauthenticatedPath(url: string): boolean {
  return (
    url === "/api/v1/health" ||
    url.startsWith("/api/v1/health?") ||
    url.startsWith("/api/docs")
  );
}

/**
 * Declare the tenant scope for every route registered in the current plugin.
 *
 * Stamps the declaration onto each route's config so the global enforcer can
 * read it. A route may still set its own `config.tenantScope`, which wins.
 */
export function declareTenantScope(
  app: FastifyInstance,
  declaration: TenantScopeDeclaration,
): void {
  app.addHook("onRoute", (routeOptions) => {
    routeOptions.config = {
      ...routeOptions.config,
      tenantScope: routeOptions.config?.tenantScope ?? declaration,
    };
  });
}

/**
 * Default-deny authorization enforcer, registered once as a global preHandler.
 *
 * Every route must declare its tenant scope (see {@link declareTenantScope}). A
 * route that declares none is refused, so a route added without a guard fails
 * closed rather than silently serving data.
 */
export function createTenantScopeEnforcer(stratum: Stratum) {
  return async function tenantScopeEnforcer(
    request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> {
    if (isUnauthenticatedPath(request.url)) return;

    const declaration = request.routeOptions?.config?.tenantScope;
    if (declaration === undefined) {
      throw new ForbiddenError("Route has no tenant-scope declaration");
    }
    if (declaration === "global") return;

    await checkTenantScope(stratum, request, declaration);
  };
}

// --- Extractors ---

/** Extract :id param (tenant routes, config routes, permission routes) */
export function fromParamId(req: FastifyRequest): string | null {
  return (req.params as Record<string, string>).id ?? null;
}

/** Extract :tenantId param (consent routes) */
export function fromParamTenantId(req: FastifyRequest): string | null {
  return (req.params as Record<string, string>).tenantId ?? null;
}

/** Extract tenant_id from query string */
export function fromQueryTenantId(req: FastifyRequest): string | null {
  return (req.query as Record<string, string>).tenant_id ?? null;
}

/** Extract tenant_id from request body */
export function fromBodyTenantId(req: FastifyRequest): string | null {
  return (req.body as Record<string, string> | null)?.tenant_id ?? null;
}

/**
 * Extract new_parent_id from a move request body: the move DESTINATION.
 *
 * A move has two tenants to authorize, not one. The route-level `:id` guard
 * only covers the tenant being moved, which a scoped key already owns, so it
 * passes on the fast path. Without authorizing the destination as well, a
 * tenant can graft itself under any other tenant and inherit that tenant's
 * resolved config (including decrypted `sensitive` values) and delegated
 * permissions, because resolution walks UP the ancestry path.
 */
export function fromBodyNewParentId(req: FastifyRequest): string | null {
  return (req.body as Record<string, string> | null)?.new_parent_id ?? null;
}
