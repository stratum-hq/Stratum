import { createParamDecorator } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";

/**
 * Parameter decorator that extracts the resolved tenant context from the request.
 * Requires StratumGuard to have run before the route handler.
 *
 * @example
 * ```ts
 * @Get('me')
 * @UseGuards(StratumGuard)
 * getProfile(@Tenant() tenant: TenantContextLegacy) {
 *   return tenant;
 * }
 * ```
 */
export const Tenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<Record<string, unknown>>();
    return req["tenant"];
  },
);
