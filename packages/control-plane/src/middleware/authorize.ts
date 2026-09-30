import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { UnauthorizedError, ForbiddenError, scopeSatisfies } from "@stratum-hq/core";
import { assertOperator } from "./tenant-scope.js";

/**
 * The scope a route requires:
 *  - "read" / "write" / "admin": the caller's key must hold that scope (admin
 *    implies write implies read).
 *  - "operator": admin scope held by a global operator API key
 *    (tenant_id === null). Tenant-scoped callers are refused.
 */
export type RequiredScope = "read" | "write" | "admin" | "operator";

declare module "fastify" {
  interface FastifyContextConfig {
    requiredScope?: RequiredScope;
  }
}

/**
 * A plugin-wide required-scope declaration: one scope for every route, or one
 * scope for safe methods (GET, HEAD, OPTIONS) and another for all others.
 */
export type RequiredScopeDeclaration =
  | RequiredScope
  | { read: RequiredScope; write: RequiredScope };

function isSafeMethod(method: string): boolean {
  return ["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

/**
 * Declare the required scope for every route registered in the current plugin.
 *
 * Stamps the scope onto each route's config when the route is registered. A
 * route may still set its own `config.requiredScope`, which wins. A route that
 * registers several methods at once must set its own `config.requiredScope`
 * unless the declaration is a single scope.
 */
export function declareRequiredScope(
  app: FastifyInstance,
  declaration: RequiredScopeDeclaration,
): void {
  app.addHook("onRoute", (routeOptions) => {
    if (routeOptions.config?.requiredScope !== undefined) return;
    let scope: RequiredScope | undefined;
    if (typeof declaration === "string") {
      scope = declaration;
    } else {
      const methods = Array.isArray(routeOptions.method)
        ? routeOptions.method
        : [routeOptions.method];
      const safe = methods.every(isSafeMethod);
      const unsafe = methods.every((method) => !isSafeMethod(method));
      // A mixed-method route stays undeclared, so it is refused.
      if (safe) scope = declaration.read;
      else if (unsafe) scope = declaration.write;
    }
    routeOptions.config = { ...routeOptions.config, requiredScope: scope };
  });
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

    // A request that matched no route reaches only the not-found handler, so
    // it is answered with 404 once the caller is authenticated.
    if (request.is404) return;

    // The required scope is a property of the matched route, declared in its
    // config (see declareRequiredScope). A route that declares none is refused.
    const requiredScope = request.routeOptions?.config?.requiredScope;
    if (requiredScope === undefined) {
      throw new ForbiddenError("Route has no required-scope declaration");
    }
    const scopes = request.apiKey.scopes ?? ["read"];

    // Hierarchical scopes: admin implies write implies read. A granted scope
    // satisfies any required scope of equal-or-lower rank.
    if (!scopeSatisfies(scopes, requiredScope === "operator" ? "admin" : requiredScope)) {
      throw new ForbiddenError("Insufficient permissions for this operation");
    }
    if (requiredScope === "operator") {
      assertOperator(request);
    }
  };
}
