import { FastifyRequest, FastifyReply } from "fastify";
import { UnauthorizedError, ForbiddenError } from "@stratum/core";

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
];

function getRequiredScope(method: string, url: string): ScopeRequirement {
  for (const pattern of ADMIN_ROUTES) {
    if (pattern.test(url)) {
      return "admin";
    }
  }
  return methodToScope(method);
}

export function createAuthorizeMiddleware() {
  return async function authorizeMiddleware(
    request: FastifyRequest,
    reply: FastifyReply,
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

    if (!scopes.includes(requiredScope)) {
      throw new ForbiddenError("Insufficient permissions for this operation");
    }
  };
}
