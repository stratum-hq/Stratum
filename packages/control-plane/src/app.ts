import crypto from "node:crypto";
import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import helmet from "@fastify/helmet";
import { Stratum } from "@stratum-hq/lib";
import { registerOpenApi } from "./openapi.js";
import { errorHandler } from "./middleware/error-handler.js";
import { createAuthMiddleware } from "./middleware/auth.js";
import { createAuthorizeMiddleware } from "./middleware/authorize.js";
import { createPerKeyRateLimitMiddleware } from "./middleware/per-key-rate-limit.js";
import { createRedisRateLimiter } from "./middleware/rate-limit-redis.js";
import { createRedisClient, checkRedisHealth } from "./redis.js";
import { healthRoutes } from "./routes/health.js";
import { createTenantRoutes } from "./routes/tenants.js";
import { createConfigRoutes } from "./routes/config.js";
import { createPermissionRoutes } from "./routes/permissions.js";
import { createApiKeyRoutes } from "./routes/api-keys.js";
import { createWebhookRoutes } from "./routes/webhooks.js";
import { createAuditLogRoutes } from "./routes/audit-logs.js";
import { createConsentRoutes } from "./routes/consent.js";
import { createMaintenanceRoutes } from "./routes/maintenance.js";
import { createRegionRoutes } from "./routes/regions.js";
import { createRoleRoutes } from "./routes/roles.js";
import { createConfigDiffRoutes } from "./routes/config-diff.js";
import { createAbacRoutes } from "./routes/abac.js";
import { registerTelemetryHooks } from "./middleware/telemetry.js";
import { config } from "./config.js";
import { getPool } from "./db/connection.js";

/** Parse a duration string like "1 minute" into milliseconds. */
function parseWindowForApp(window: string): number {
  const match = window.match(/^(\d+)\s*(second|minute|hour|day)s?$/i);
  if (!match) return 60_000;
  const value = parseInt(match[1], 10);
  switch (match[2].toLowerCase()) {
    case "second": return value * 1_000;
    case "minute": return value * 60_000;
    case "hour":   return value * 3_600_000;
    case "day":    return value * 86_400_000;
    default:       return 60_000;
  }
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.nodeEnv === "production" ? "info" : "debug",
      redact: ["req.headers.authorization", "req.headers['x-api-key']"],
    },
    genReqId: () => crypto.randomUUID(),
  });

  const stratum = new Stratum({
    pool: getPool(),
    keyPrefix: config.nodeEnv === "production" ? "sk_live_" : "sk_test_",
  });

  await app.register(helmet as any, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https://fastify.dev"],
      },
    },
  });
  await app.register(cors as any, {
    origin: config.allowedOrigins,
    credentials: true,
  });
  await app.register(rateLimit as any, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindow,
  });

  // OpenTelemetry request tracing (no-op if @opentelemetry/api is absent)
  registerTelemetryHooks(app);

  await registerOpenApi(app);
  app.addHook("preHandler", createAuthMiddleware(stratum));
  app.addHook("preHandler", createAuthorizeMiddleware());

  // Use Redis-backed rate limiting when REDIS_URL is configured, otherwise in-memory
  const redisClient = createRedisClient();
  if (redisClient) {
    const windowMs = parseWindowForApp(config.rateLimitWindow);
    app.addHook(
      "preHandler",
      createRedisRateLimiter(redisClient, {
        maxRequests: config.rateLimitMax,
        windowMs,
      }),
    );
    app.log.info("Per-key rate limiting: Redis-backed (REDIS_URL configured)");
  } else {
    app.addHook("preHandler", createPerKeyRateLimitMiddleware());
    app.log.info("Per-key rate limiting: in-memory (no REDIS_URL)");
  }

  app.setErrorHandler(errorHandler);

  await app.register(healthRoutes(checkRedisHealth));
  await app.register(createTenantRoutes(stratum), { prefix: "/api/v1/tenants" });
  await app.register(createConfigRoutes(stratum), { prefix: "/api/v1/tenants/:id/config" });
  await app.register(createPermissionRoutes(stratum), { prefix: "/api/v1/tenants/:id/permissions" });
  await app.register(createApiKeyRoutes(stratum), { prefix: "/api/v1/api-keys" });
  await app.register(createWebhookRoutes(stratum), { prefix: "/api/v1/webhooks" });
  await app.register(createAuditLogRoutes(stratum), { prefix: "/api/v1/audit-logs" });
  await app.register(createConsentRoutes(stratum), { prefix: "/api/v1/tenants/:tenantId/consent" });
  await app.register(createRegionRoutes(stratum), { prefix: "/api/v1/regions" });
  await app.register(createRoleRoutes(stratum), { prefix: "/api/v1/roles" });
  await app.register(createMaintenanceRoutes(stratum), { prefix: "/api/v1/maintenance" });
  await app.register(createConfigDiffRoutes(stratum), { prefix: "/api/v1/config" });
  await app.register(createAbacRoutes(stratum), { prefix: "/api/v1/tenants/:tenantId/abac-policies" });

  return app;
}
