import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import helmet from "@fastify/helmet";
import { Stratum } from "@stratum/lib";
import { registerOpenApi } from "./openapi.js";
import { errorHandler } from "./middleware/error-handler.js";
import { createAuthMiddleware } from "./middleware/auth.js";
import { healthRoutes } from "./routes/health.js";
import { createTenantRoutes } from "./routes/tenants.js";
import { createConfigRoutes } from "./routes/config.js";
import { createPermissionRoutes } from "./routes/permissions.js";
import { createApiKeyRoutes } from "./routes/api-keys.js";
import { config } from "./config.js";
import { getPool } from "./db/connection.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
  });

  const stratum = new Stratum({
    pool: getPool(),
    keyPrefix: config.nodeEnv === "production" ? "sk_live_" : "sk_test_",
  });

  await app.register(helmet as any);
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
  app.setErrorHandler(errorHandler);

  await app.register(healthRoutes);
  await app.register(createTenantRoutes(stratum), { prefix: "/api/v1/tenants" });
  await app.register(createConfigRoutes(stratum), { prefix: "/api/v1/tenants/:id/config" });
  await app.register(createPermissionRoutes(stratum), { prefix: "/api/v1/tenants/:id/permissions" });
  await app.register(createApiKeyRoutes(stratum), { prefix: "/api/v1/api-keys" });

  return app;
}
