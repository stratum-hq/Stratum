import crypto from "node:crypto";

const jwtSecretEnv = process.env.JWT_SECRET;
const nodeEnv = process.env.NODE_ENV || "development";

if (!jwtSecretEnv) {
  if (nodeEnv === "production" || nodeEnv === "staging") {
    throw new Error("FATAL: JWT_SECRET must be set in production. Refusing to start.");
  } else {
    console.warn("[stratum] JWT_SECRET not set — using dev fallback. Set JWT_SECRET before deploying to production.");
  }
}

export const config = {
  port: parseInt(process.env.PORT || "3001"),
  databaseUrl: process.env.DATABASE_URL || "postgres://stratum:stratum_dev@localhost:5432/stratum",
  nodeEnv,
  jwtSecret: jwtSecretEnv || crypto.randomBytes(32).toString("hex"),
  allowedOrigins: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
    : ["http://localhost:3000", "http://localhost:3300"],
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || "100"),
  rateLimitWindow: process.env.RATE_LIMIT_WINDOW || "1 minute",
  redisUrl: process.env.REDIS_URL || undefined,
};
