import type { Context, Next, MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { controlPlaneErrorResponse, runWithTenantContext, tenantErrorResponse } from "@stratum-hq/sdk";
import type { ResolvedTenantContext } from "@stratum-hq/core";
import { IsolationStrategy } from "@stratum-hq/core";

export interface StratumMiddlewareOptions {
  /** Header name to extract tenant ID from (default: 'x-tenant-id') */
  header?: string;
  /** JWT claim name to extract tenant ID from */
  jwtClaim?: string;
  /**
   * URL path parameter name to extract tenant ID from. The client chooses the
   * path, so this also requires `trustPathParam: true`.
   */
  pathParam?: string;
  /**
   * Allow reading the tenant ID from the `pathParam` URL path parameter. A
   * client can put any tenant ID in the path, so this must be enabled
   * explicitly, and only when your application separately authorizes the
   * caller for that tenant. Without it, `stratumMiddleware` throws at
   * construction when `pathParam` is the tenant source. Default: false.
   */
  trustPathParam?: boolean;
  /**
   * Allow reading the tenant ID from a request header. A client can set any
   * header, so this must be enabled explicitly, and only when a gateway you
   * control sets the header and strips any client-sent copy. Without it,
   * `stratumMiddleware` throws at construction unless `jwtClaim` or
   * `pathParam` is set. Default: false.
   */
  trustTenantHeader?: boolean;
  /**
   * Optional callback to resolve a full tenant context from the tenant ID.
   * When provided, the middleware will call this to obtain ancestry, config,
   * and permissions instead of using placeholder values.
   *
   * If the callback rejects with a tenant error from `@stratum-hq/core`, for
   * example from `StratumClient.resolveTenant`, the middleware answers 404,
   * 403 or 410. A control plane timeout answers 504. A rejected SDK API key
   * answers 500 and writes the cause to `console.error`. Other errors go to
   * the Hono error handler.
   */
  resolve?: (tenantId: string) => Promise<ResolvedTenantContext> | ResolvedTenantContext;
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
 * AsyncLocalStorage context via `runWithTenantContext()`.
 */
export function stratumMiddleware(
  options: StratumMiddlewareOptions = {},
): MiddlewareHandler {
  if (!options.jwtClaim && options.pathParam && options.trustPathParam !== true) {
    throw new Error(
      "[stratum] stratumMiddleware would read the tenant ID from an unverified URL path parameter. " +
        "Use jwtClaim with a verified JWT, or set trustPathParam: true if your application authorizes the caller for that tenant.",
    );
  }

  if (!options.jwtClaim && !options.pathParam && options.trustTenantHeader !== true) {
    throw new Error(
      "[stratum] stratumMiddleware would read the tenant ID from an unverified request header. " +
        "Use jwtClaim with a verified JWT, or set trustTenantHeader: true if a trusted gateway sets the header.",
    );
  }

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

    let ctx: ResolvedTenantContext;
    try {
      ctx = options.resolve
        ? await options.resolve(tenantId)
        : /**
           * @warning Placeholder context: ancestry_path, resolved_config, and
           * resolved_permissions are stub values. Provide a `resolve` callback
           * to populate real tenant data.
           */
          {
            tenant_id: tenantId,
            ancestry_path: tenantId,
            depth: 0,
            resolved_config: {},
            resolved_permissions: {},
            isolation_strategy: IsolationStrategy.SHARED_RLS,
          };
    } catch (err) {
      const response = tenantErrorResponse(err, tenantId) ?? controlPlaneErrorResponse(err);
      if (!response) throw err;
      return c.json(response.body, response.status as ContentfulStatusCode);
    }

    return runWithTenantContext(ctx, () => next());
  };
}
