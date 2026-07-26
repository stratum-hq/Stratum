import { FastifyRequest, FastifyReply } from "fastify";
import { UnauthorizedError, ForbiddenError, scopeSatisfies } from "@stratum-hq/core";

type ScopeRequirement = "read" | "write" | "admin";

function methodToScope(method: string): ScopeRequirement {
  switch (method.toUpperCase()) {
    case "GET":
    case "HEAD":
    case "OPTIONS":
      return "read";
    default:
      return "write";
  }
}

// Route patterns that require admin scope for ALL methods
const ADMIN_ROUTES = [
  /^\/api\/v1\/api-keys/,
  /^\/api\/v1\/audit-logs/,
  /^\/api\/v1\/maintenance/,
  /^\/api\/v1\/regions/,
  /^\/api\/v1\/tenants\/[^/]+\/purge$/,
  /^\/api\/v1\/tenants\/[^/]+\/export$/,
  /^\/api\/v1\/tenants\/[^/]+\/migrate-region$/,
  /^\/api\/v1\/tenants\/[^/]+\/context$/,
];

function getRequiredScope(method: string, url: string): ScopeRequirement {
  // Match on the request path. Take everything before the first "?" so the
  // route match is evaluated on the normalized path alone.
  const path = url.split("?", 1)[0];
  for (const pattern of ADMIN_ROUTES) {
    if (pattern.test(path)) {
      return "admin";
    }
  }
  return methodToScope(method);
}

export function createAuthorizeMiddleware() {
  return async function authorizeMiddleware(
    request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> {
    // Skip for health and documentation endpoints
    if (
      request.url === "/api/v1/health" ||
      request.url.startsWith("/api/v1/health?") ||
      request.url.startsWith("/api/docs")
    ) {
      return;
    }

    // If no apiKey, auth middleware should have rejected — fail closed
    if (!request.apiKey) {
      throw new UnauthorizedError("Authentication required");
    }

    const requiredScope = getRequiredScope(request.method, request.url);
    const scopes = request.apiKey.scopes ?? ["read"];

    // Hierarchical scopes: admin implies write implies read. A granted scope
    // satisfies any required scope of equal-or-lower rank.
    if (!scopeSatisfies(scopes, requiredScope)) {
      throw new ForbiddenError("Insufficient permissions for this operation");
    }
  };
}
