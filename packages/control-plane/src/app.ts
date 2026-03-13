import crypto from "node:crypto";
import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import helmet from "@fastify/helmet";
import { Stratum } from "@stratum/lib";
import { registerOpenApi } from "./openapi.js";
import { errorHandler } from "./middleware/error-handler.js";
import { createAuthMiddleware } from "./middleware/auth.js";
import { createAuthorizeMiddleware } from "./middleware/authorize.js";
import { createPerKeyRateLimitMiddleware } from "./middleware/per-key-rate-limit.js";
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
import { config } from "./config.js";
import { getPool } from "./db/connection.js";

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

  await registerOpenApi(app);
  app.addHook("preHandler", createAuthMiddleware(stratum));
  app.addHook("preHandler", createAuthorizeMiddleware());
  app.addHook("preHandler", createPerKeyRateLimitMiddleware());
  app.setErrorHandler(errorHandler);

  await app.register(healthRoutes);
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

  return app;
}
