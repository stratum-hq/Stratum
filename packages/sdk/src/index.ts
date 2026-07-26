import { StratumClient } from "./client.js";
import type { StratumClientOptions } from "./client.js";
import { expressMiddleware } from "./middleware/express.js";
import { fastifyPlugin } from "./middleware/fastify.js";
import { getTenantContext, runWithTenantContext } from "./context.js";
import type { MiddlewareOptions } from "./types.js";

export function stratum(options: StratumClientOptions) {
  const client = new StratumClient(options);
  return {
    client,
    middleware: (opts?: MiddlewareOptions) => expressMiddleware(client, opts),
    plugin: (opts?: MiddlewareOptions) =>
      (
        fastify: Parameters<typeof fastifyPlugin>[0],
        _opts: unknown,
        done: Parameters<typeof fastifyPlugin>[2],
      ) =>
        fastifyPlugin(fastify, { client, ...opts }, done),
    getTenantContext,
    runWithTenantContext,
  };
}

// Named exports for direct usage
export { StratumClient } from "./client.js";
export type { StratumClientOptions } from "./client.js";
export { getTenantContext, runWithTenantContext, setTenantContext } from "./context.js";
export { expressMiddleware } from "./middleware/express.js";
export { fastifyPlugin } from "./middleware/fastify.js";
export { resolveFromHeader } from "./resolvers/header.js";
export { resolveFromJwt } from "./resolvers/jwt.js";
export type { TenantResolver } from "./resolvers/custom.js";
export type { MiddlewareOptions } from "./types.js";

// Re-export core types for convenience
export type {
  ResolvedTenantContext,
  TenantNode,
  CreateTenantInput,
  UpdateTenantInput,
  MoveTenantInput,
  ResolvedPermission,
} from "@stratum-hq/core";
