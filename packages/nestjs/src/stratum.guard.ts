import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import type { StratumClient } from "@stratum-hq/sdk";
import { TenantNotFoundError } from "@stratum-hq/core";
import { STRATUM_CLIENT } from "./constants.js";

@Injectable()
export class StratumGuard implements CanActivate {
  constructor(@Inject(STRATUM_CLIENT) private readonly client: StratumClient) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Record<string, unknown> & { headers?: Record<string, string | undefined>; tenant?: unknown }>();

    // Resolve tenant ID: x-tenant-id header first, then Authorization JWT claim
    let tenantId: string | null = null;

    const headers = req.headers as Record<string, string | undefined> | undefined;

    if (headers) {
      // Check x-tenant-id header
      const headerVal = headers["x-tenant-id"];
      if (headerVal) {
        tenantId = headerVal;
      }

      // Fall back to JWT Authorization header — extract sub or tenant_id claim
      if (!tenantId) {
        const auth = headers["authorization"];
        if (auth && auth.startsWith("Bearer ")) {
          const token = auth.slice(7);
          try {
            // Decode payload without verification (verification is responsibility of auth guard)
            const parts = token.split(".");
            if (parts.length === 3) {
              const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8")) as Record<string, unknown>;
              const claim = payload["tenant_id"] ?? payload["tenantId"] ?? payload["sub"];
              if (typeof claim === "string") {
                tenantId = claim;
              }
            }
          } catch {
            // Malformed JWT — ignore and continue
          }
        }
      }
    }

    if (!tenantId) {
      throw new UnauthorizedException("Tenant ID could not be resolved from request");
    }

    try {
      const tenantContext = await this.client.resolveTenant(tenantId);
      req["tenant"] = tenantContext;
      return true;
    } catch (err) {
      if (err instanceof TenantNotFoundError) {
        throw new UnauthorizedException(`Tenant not found: ${tenantId}`);
      }
      throw err;
    }
  }
}
