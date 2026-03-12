import { FastifyRequest, FastifyReply } from "fastify";
import { UnauthorizedError } from "@stratum/core";

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
  /^\/api\/v1\/tenants\/[^/]+\/purge$/,
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
    // Skip for health endpoint
    if (request.url === "/api/v1/health" || request.url.startsWith("/api/v1/health?")) {
      return;
    }

    // Skip if no apiKey (auth middleware will have already rejected)
    if (!request.apiKey) return;

    const requiredScope = getRequiredScope(request.method, request.url);
    const scopes = request.apiKey.scopes ?? ["read", "write"];

    if (!scopes.includes(requiredScope)) {
      throw new UnauthorizedError("Insufficient permissions for this operation");
    }
  };
}
