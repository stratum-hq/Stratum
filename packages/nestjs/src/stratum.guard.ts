import {
  Inject,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  GatewayTimeoutException,
  GoneException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import type { StratumClient } from "@stratum-hq/sdk";
import { assertJwtSupport, controlPlaneErrorResponse, resolveTenantId, tenantErrorResponse } from "@stratum-hq/sdk";
import { STRATUM_CLIENT, STRATUM_OPTIONS } from "./constants.js";
import type { StratumModuleOptions } from "./stratum.module.js";

const EXCEPTIONS: Record<number, new (message: string) => HttpException> = {
  403: ForbiddenException,
  404: NotFoundException,
  410: GoneException,
  500: InternalServerErrorException,
  504: GatewayTimeoutException,
};

/**
 * Convert a tenant resolution error into the HTTP exception for the status
 * that the SDK's Express and Fastify middleware send for the same error.
 * Other errors come back unchanged, so Nest answers them with a 500.
 */
function resolutionException(err: unknown, tenantId: string): unknown {
  const response = tenantErrorResponse(err, tenantId) ?? controlPlaneErrorResponse(err);
  if (!response) return err;
  const Exception = EXCEPTIONS[response.status];
  const message = response.body.error.message;
  return Exception ? new Exception(message) : new HttpException(message, response.status);
}

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
      throw resolutionException(err, tenantId);
    }

    req["tenant"] = callerContext;
    req["impersonating"] = false;

    // 3. Impersonation support — mirrors express.ts
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
          throw resolutionException(err, impersonateTenantId);
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
