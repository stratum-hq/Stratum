import { TenantNotFoundError } from "@stratum/core";
import type { TenantContext } from "@stratum/core";
import type { StratumClient } from "../client.js";
import type { MiddlewareOptions } from "../types.js";
import { runWithTenantContext } from "../context.js";
import { resolveFromJwt } from "../resolvers/jwt.js";
import { resolveFromHeader } from "../resolvers/header.js";

export function fastifyPlugin(
  fastify: any,
  options: { client: StratumClient } & MiddlewareOptions,
  done: any,
): void {
  const { client, ...middlewareOptions } = options;

  fastify.decorateRequest("tenant", null);

  fastify.addHook("onRequest", (request: any, reply: any, done: any) => {
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

      let context: TenantContext;
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

      // Use run (not enterWith) to bind context only for this request's lifecycle
      runWithTenantContext(context, done);
    };

    resolveAndRun().catch(done);
  });

  done();
}
