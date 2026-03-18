import { TenantNotFoundError } from "@stratum-hq/core";
import type { StratumClient } from "../client.js";
import type { MiddlewareOptions } from "../types.js";
import { runWithTenantContext } from "../context.js";
import { resolveFromJwt } from "../resolvers/jwt.js";
import { resolveFromHeader } from "../resolvers/header.js";

export function expressMiddleware(client: StratumClient, options?: MiddlewareOptions) {
  return async (req: any, res: any, next: any): Promise<void> => {
    try {
      // Resolve tenant ID: JWT → header → custom resolvers
      let tenantId: string | null = null;

      tenantId = resolveFromJwt(req, options?.jwtClaimPath, {
        secret: options?.jwtSecret,
        verify: options?.jwtVerify,
      });

      if (!tenantId) {
        tenantId = resolveFromHeader(req);
      }

      if (!tenantId && options?.resolvers) {
        for (const resolver of options.resolvers) {
          const result = await resolver.resolve(req);
          if (result) {
            tenantId = result;
            break;
          }
        }
      }

      if (!tenantId) {
        res.status(400).json({ error: { code: "MISSING_TENANT", message: "Tenant ID could not be resolved from request" } });
        return;
      }

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
