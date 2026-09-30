import { TenantNotFoundError } from "@stratum-hq/core";
import type { StratumClient } from "../client.js";
import type { MiddlewareOptions } from "../types.js";
import { runWithTenantContext } from "../context.js";
import { assertJwtSupport } from "../resolvers/jwt.js";
import { resolveTenantId } from "../resolvers/resolve.js";

// Minimal structural types for the Express surface this middleware touches, so
// the SDK does not take a hard dependency on `express` types in its published API.
type NextFn = (err?: unknown) => void;

type ExpressRequestLike = {
  headers?: Record<string, string | string[] | undefined>;
  tenant?: unknown;
  impersonating?: boolean;
  originalTenantId?: string | null;
};

type ExpressResponseLike = {
  status(code: number): { json(body: unknown): void };
};

export function expressMiddleware(client: StratumClient, options?: MiddlewareOptions) {
  assertJwtSupport(options);
  return async (req: ExpressRequestLike, res: ExpressResponseLike, next: NextFn): Promise<void> => {
    try {
      // Resolve tenant ID: JWT → header → custom resolvers
      const resolution = await resolveTenantId(req, options);

      if (resolution.status === "invalid_token") {
        res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Bearer token could not be verified" } });
        return;
      }

      if (resolution.status === "missing") {
        res.status(400).json({ error: { code: "MISSING_TENANT", message: "Tenant ID could not be resolved from request" } });
        return;
      }

      const tenantId = resolution.tenantId;

      let context;
      try {
        context = await client.resolveTenant(tenantId);
      } catch (err) {
        if (err instanceof TenantNotFoundError) {
          res.status(404).json({ error: { code: "TENANT_NOT_FOUND", message: `Tenant not found: ${tenantId}` } });
          return;
        }
        throw err;
      }

      req.tenant = context;
      req.impersonating = false;

      // Impersonation: check for X-Impersonate-Tenant header
      if (options?.impersonation?.enabled) {
        const impersonateHeader = options.impersonation.headerName || "X-Impersonate-Tenant";
        const impersonateTenantId = req.headers?.[impersonateHeader.toLowerCase()] as string | undefined;

        if (impersonateTenantId && impersonateTenantId !== tenantId) {
          const authorized = await options.impersonation.authorize(req, tenantId, impersonateTenantId);
          if (!authorized) {
            res.status(403).json({
              error: {
                code: "IMPERSONATION_DENIED",
                message: "Not authorized to impersonate this tenant",
              },
            });
            return;
          }

          // Resolve the impersonated tenant's context
          const impersonatedContext = await client.resolveTenant(impersonateTenantId);
          req.tenant = impersonatedContext;
          req.impersonating = true;
          req.originalTenantId = tenantId;

          options.impersonation.onImpersonate?.(req, tenantId, impersonateTenantId);

          runWithTenantContext(impersonatedContext, () => {
            next();
          });
          return;
        }
      }

      runWithTenantContext(context, () => {
        next();
      });
    } catch (err) {
      if (options?.onError && err instanceof Error) {
        options.onError(err, req);
      }
      next(err);
    }
  };
}
