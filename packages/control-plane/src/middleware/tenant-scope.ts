import { FastifyRequest, FastifyReply } from "fastify";
import { ForbiddenError } from "@stratum-hq/core";
import { Stratum } from "@stratum-hq/lib";

/**
 * Tenant-scope enforcement middleware.
 *
 * Ensures that tenant-scoped API keys can only access data belonging
 * to their own tenant or its descendants in the hierarchy.
 *
 * Global keys (tenant_id === null) have unrestricted access.
 */
export function createTenantScopeGuard(
  stratum: Stratum,
  extractTenantId: (req: FastifyRequest) => string | null,
) {
  return async function tenantScopeGuard(
    request: FastifyRequest,
    _reply: FastifyReply,
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
      // Tenant not found — fail closed for scoped keys
      throw new ForbiddenError(
        "API key tenant scope does not grant access to this tenant",
      );
    }

    throw new ForbiddenError(
      "API key tenant scope does not grant access to this tenant",
    );
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
