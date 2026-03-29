import type { Context, Next, MiddlewareHandler } from "hono";
import { setTenantContext } from "@stratum-hq/sdk";
import { IsolationStrategy } from "@stratum-hq/core";

export interface StratumMiddlewareOptions {
  /** Header name to extract tenant ID from (default: 'x-tenant-id') */
  header?: string;
  /** JWT claim name to extract tenant ID from */
  jwtClaim?: string;
  /** URL path parameter name to extract tenant ID from */
  pathParam?: string;
}

function extractFromHeader(c: Context, header: string): string | undefined {
  return c.req.header(header) ?? undefined;
}

function extractFromJwtClaim(c: Context, claim: string): string | undefined {
  // Hono's JWT middleware sets the payload on the context variable 'jwtPayload'
  const payload = c.get("jwtPayload") as Record<string, unknown> | undefined;
  if (!payload) return undefined;
  const value = payload[claim];
  return typeof value === "string" ? value : undefined;
}

function extractFromPathParam(c: Context, param: string): string | undefined {
  return c.req.param(param) ?? undefined;
}

/**
 * Hono middleware that extracts a tenant ID from the request and sets it
 * in both the Hono context (`c.get('tenantId')`) and the SDK's
 * AsyncLocalStorage context via `setTenantContext()`.
 */
export function stratumMiddleware(
  options: StratumMiddlewareOptions = {},
): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    let tenantId: string | undefined;

    if (options.jwtClaim) {
      tenantId = extractFromJwtClaim(c, options.jwtClaim);
    } else if (options.pathParam) {
      tenantId = extractFromPathParam(c, options.pathParam);
    } else {
      const header = options.header ?? "x-tenant-id";
      tenantId = extractFromHeader(c, header);
    }

    if (!tenantId) {
      return c.json({ error: "Missing tenant ID" }, 400);
    }

    c.set("tenantId", tenantId);

    setTenantContext({
      tenant_id: tenantId,
      ancestry_path: tenantId,
      depth: 0,
      resolved_config: {},
      resolved_permissions: {},
      isolation_strategy: IsolationStrategy.SHARED_RLS,
    });

    await next();
  };
}
