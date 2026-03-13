import { FastifyRequest, FastifyReply } from "fastify";
import { ForbiddenError } from "@stratum/core";
import { Stratum } from "@stratum/lib";

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
    if (!apiKey || apiKey.tenant_id === null) return;

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
