import { Inject, Injectable, UnauthorizedException, ForbiddenException } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import type { StratumClient } from "@stratum-hq/sdk";
import { resolveFromHeader, resolveFromJwt, setTenantContext } from "@stratum-hq/sdk";
import { TenantNotFoundError } from "@stratum-hq/core";
import { STRATUM_CLIENT, STRATUM_OPTIONS } from "./constants.js";
import type { StratumModuleOptions } from "./stratum.module.js";

@Injectable()
export class StratumGuard implements CanActivate {
  constructor(
    @Inject(STRATUM_CLIENT) private readonly client: StratumClient,
    @Inject(STRATUM_OPTIONS) private readonly options: StratumModuleOptions,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Record<string, unknown> & {
      headers?: Record<string, string | string[] | undefined>;
      tenant?: unknown;
      impersonating?: boolean;
      originalTenantId?: string;
    }>();

    // 1. Resolve tenant ID: header → JWT (verified) → custom resolvers
    let tenantId: string | null = null;

    tenantId = resolveFromHeader(req);

    if (!tenantId) {
      tenantId = resolveFromJwt(req, this.options.jwtClaimPath, {
        secret: this.options.jwtSecret,
        verify: this.options.jwtVerify,
      });
    }

    if (!tenantId && this.options.resolvers) {
      for (const resolver of this.options.resolvers) {
        const result = await resolver.resolve(req);
        if (result) {
          tenantId = result;
          break;
        }
      }
    }

    if (!tenantId) {
      throw new UnauthorizedException("Tenant ID could not be resolved from request");
    }

    // 2. Resolve caller tenant context
    let callerContext;
    try {
      callerContext = await this.client.resolveTenant(tenantId);
    } catch (err) {
      if (err instanceof TenantNotFoundError) {
        throw new UnauthorizedException(`Tenant not found: ${tenantId}`);
      }
      throw err;
    }

    req["tenant"] = callerContext;
    req["impersonating"] = false;

    // 3. Impersonation support — mirrors express.ts lines 52-81
    if (this.options.impersonation?.enabled) {
      const impersonateHeader = this.options.impersonation.headerName ?? "X-Impersonate-Tenant";
      const headers = req.headers as Record<string, string | string[] | undefined> | undefined;
      const rawVal = headers?.[impersonateHeader.toLowerCase()];
      const impersonateTenantId = Array.isArray(rawVal) ? rawVal[0] : rawVal;

      if (impersonateTenantId && impersonateTenantId !== tenantId) {
        const authorized = await this.options.impersonation.authorize(req, tenantId, impersonateTenantId);
        if (!authorized) {
          throw new ForbiddenException("Not authorized to impersonate this tenant");
        }

        let impersonatedContext;
        try {
          impersonatedContext = await this.client.resolveTenant(impersonateTenantId);
        } catch (err) {
          if (err instanceof TenantNotFoundError) {
            throw new UnauthorizedException(`Impersonated tenant not found: ${impersonateTenantId}`);
          }
          throw err;
        }

        req["tenant"] = impersonatedContext;
        req["impersonating"] = true;
        req["originalTenantId"] = tenantId;

        this.options.impersonation.onImpersonate?.(req, tenantId, impersonateTenantId);

        // 4. Bind AsyncLocalStorage context for getTenantContext()
        setTenantContext(impersonatedContext);
        return true;
      }
    }

    // 4. Bind AsyncLocalStorage context for getTenantContext()
    setTenantContext(callerContext);
    return true;
  }
}
