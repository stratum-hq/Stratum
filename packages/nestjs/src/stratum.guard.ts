import { Inject, Injectable, UnauthorizedException, ForbiddenException } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import type { StratumClient } from "@stratum-hq/sdk";
import { assertJwtSupport, resolveTenantId } from "@stratum-hq/sdk";
import { TenantNotFoundError } from "@stratum-hq/core";
import { STRATUM_CLIENT, STRATUM_OPTIONS } from "./constants.js";
import type { StratumModuleOptions } from "./stratum.module.js";

@Injectable()
export class StratumGuard implements CanActivate {
  constructor(
    @Inject(STRATUM_CLIENT) private readonly client: StratumClient,
    @Inject(STRATUM_OPTIONS) private readonly options: StratumModuleOptions,
  ) {
    assertJwtSupport(options);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Record<string, unknown> & {
      headers?: Record<string, string | string[] | undefined>;
      tenant?: unknown;
      impersonating?: boolean;
      originalTenantId?: string;
    }>();

    // 1. Resolve tenant ID: JWT (verified) → header → custom resolvers.
    //    When JWT verification is configured, a token that fails verification
    //    is rejected, and the header is only read if trustTenantHeader is set.
    //    Order mirrors express.ts.
    const resolution = await resolveTenantId(req, this.options);

    if (resolution.status === "invalid_token") {
      throw new UnauthorizedException("Bearer token could not be verified");
    }

    if (resolution.status === "missing") {
      throw new UnauthorizedException("Tenant ID could not be resolved from request");
    }

    const tenantId = resolution.tenantId;

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

        return true;
      }
    }

    return true;
  }
}
