import { TenantNotFoundError } from "@stratum-hq/core";
import type { ResolvedTenantContext } from "@stratum-hq/core";
import type { StratumClient } from "../client.js";
import type { MiddlewareOptions } from "../types.js";
import { runWithTenantContext } from "../context.js";
import { assertJwtSupport } from "../resolvers/jwt.js";
import { resolveTenantId } from "../resolvers/resolve.js";

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
  assertJwtSupport(middlewareOptions);

  fastify.decorateRequest("tenant", null);
  fastify.decorateRequest("impersonating", false);
  fastify.decorateRequest("originalTenantId", null);

  fastify.addHook("onRequest", (request: FastifyRequestLike, reply: FastifyReplyLike, done: DoneFn) => {
    const resolveAndRun = async () => {
      // Resolve tenant ID: JWT → header → custom resolvers
      const resolution = await resolveTenantId(request, middlewareOptions);

      if (resolution.status === "invalid_token") {
        reply.status(401).send({ error: { code: "INVALID_TOKEN", message: "Bearer token could not be verified" } });
        return;
      }

      if (resolution.status === "missing") {
        reply.status(400).send({ error: { code: "MISSING_TENANT", message: "Tenant ID could not be resolved from request" } });
        return;
      }

      const tenantId = resolution.tenantId;

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

// Register the hook and decorators on the instance that calls
// `register(fastifyPlugin)`, not in an encapsulated child context, so routes
// declared on that instance run the tenant hook (the fastify-plugin convention).
(fastifyPlugin as unknown as Record<symbol, unknown>)[Symbol.for("skip-override")] = true;
