import { TenantNotFoundError } from "@stratum-hq/core";
import type { ResolvedTenantContext } from "@stratum-hq/core";
import type { StratumClient } from "../client.js";
import type { MiddlewareOptions } from "../types.js";
import { runWithTenantContext } from "../context.js";
import { resolveFromJwt } from "../resolvers/jwt.js";
import { resolveFromHeader } from "../resolvers/header.js";

// Minimal structural types for the Fastify surface this plugin touches, so the
// SDK does not take a hard dependency on `fastify` types in its published API.
type DoneFn = (err?: unknown) => void;

interface FastifyRequestLike {
  headers?: Record<string, string | string[] | undefined>;
  tenant?: unknown;
  impersonating?: boolean;
  originalTenantId?: string | null;
}

interface FastifyReplyLike {
  status(code: number): { send(body: unknown): void };
}

interface FastifyLike {
  decorateRequest(name: string, value: unknown): void;
  addHook(
    event: string,
    handler: (request: FastifyRequestLike, reply: FastifyReplyLike, done: DoneFn) => void,
  ): void;
}

export function fastifyPlugin(
  fastify: FastifyLike,
  options: { client: StratumClient } & MiddlewareOptions,
  done: DoneFn,
): void {
  const { client, ...middlewareOptions } = options;

  fastify.decorateRequest("tenant", null);
  fastify.decorateRequest("impersonating", false);
  fastify.decorateRequest("originalTenantId", null);

  fastify.addHook("onRequest", (request: FastifyRequestLike, reply: FastifyReplyLike, done: DoneFn) => {
    // Resolve tenant ID: JWT → header → custom resolvers
    let tenantId: string | null = null;

    tenantId = resolveFromJwt(request, middlewareOptions.jwtClaimPath, {
      secret: middlewareOptions.jwtSecret,
      verify: middlewareOptions.jwtVerify,
    });

    if (!tenantId) {
      tenantId = resolveFromHeader(request);
    }

    const resolveAndRun = async () => {
      if (!tenantId && middlewareOptions.resolvers) {
        for (const resolver of middlewareOptions.resolvers) {
          const result = await resolver.resolve(request);
          if (result) {
            tenantId = result;
            break;
          }
        }
      }

      if (!tenantId) {
        reply.status(400).send({ error: { code: "MISSING_TENANT", message: "Tenant ID could not be resolved from request" } });
        return;
      }

      let context: ResolvedTenantContext;
      try {
        context = await client.resolveTenant(tenantId);
      } catch (err) {
        if (err instanceof TenantNotFoundError) {
          reply.status(404).send({ error: { code: "TENANT_NOT_FOUND", message: `Tenant not found: ${tenantId}` } });
          return;
        }
        if (middlewareOptions.onError && err instanceof Error) {
          middlewareOptions.onError(err, request);
        }
        throw err;
      }

      request.tenant = context;
      request.impersonating = false;

      // Impersonation: check for X-Impersonate-Tenant header
      if (middlewareOptions.impersonation?.enabled) {
        const impersonateHeader = (middlewareOptions.impersonation.headerName || "X-Impersonate-Tenant").toLowerCase();
        const impersonateTenantId = request.headers?.[impersonateHeader] as string | undefined;

        if (impersonateTenantId && impersonateTenantId !== tenantId) {
          const authorized = await middlewareOptions.impersonation.authorize(request, tenantId, impersonateTenantId);
          if (!authorized) {
            reply.status(403).send({
              error: {
                code: "IMPERSONATION_DENIED",
                message: "Not authorized to impersonate this tenant",
              },
            });
            return;
          }

          const impersonatedContext = await client.resolveTenant(impersonateTenantId);
          request.tenant = impersonatedContext;
          request.impersonating = true;
          request.originalTenantId = tenantId;

          middlewareOptions.impersonation.onImpersonate?.(request, tenantId, impersonateTenantId);

          runWithTenantContext(impersonatedContext, done);
          return;
        }
      }

      // Use run (not enterWith) to bind context only for this request's lifecycle
      runWithTenantContext(context, done);
    };

    resolveAndRun().catch(done);
  });

  done();
}
