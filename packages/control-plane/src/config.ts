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

// Placeholder secrets published in this repository's examples and scaffolds.
const PLACEHOLDER_JWT_SECRETS = new Set([
  "change-me-in-production",
  "stratum-demo-secret-do-not-use-in-production",
  "your-jwt-secret-change-in-production",
]);
const MIN_JWT_SECRET_BYTES = 32;

if (jwtSecretEnv && nodeEnv === "production") {
  if (PLACEHOLDER_JWT_SECRETS.has(jwtSecretEnv)) {
    throw new Error("FATAL: JWT_SECRET is a published placeholder value. Set a random secret. Refusing to start.");
  }
  if (Buffer.byteLength(jwtSecretEnv, "utf8") < MIN_JWT_SECRET_BYTES) {
    throw new Error(`FATAL: JWT_SECRET must be at least ${MIN_JWT_SECRET_BYTES} bytes in production. Refusing to start.`);
  }
}

// Optional JWT audience / issuer binding. When set, a Bearer token is accepted
// only if its `aud` (and `iss`) claim matches, so tokens minted for another
// application that shares JWT_SECRET are refused. Unset keeps the previous
// behavior (no aud / iss check) for deployments whose tokens do not carry them.
const jwtAudienceEnv = process.env.JWT_AUDIENCE || undefined;
const jwtIssuerEnv = process.env.JWT_ISSUER || undefined;

if (!jwtAudienceEnv && (nodeEnv === "production" || nodeEnv === "staging")) {
  console.warn("[stratum] JWT_AUDIENCE not set — Bearer tokens are not bound to the control plane. Set JWT_AUDIENCE (for example stratum-control-plane).");
}

export const config = {
  port: parseInt(process.env.PORT || "3001"),
  databaseUrl: process.env.DATABASE_URL || "postgres://stratum:stratum_dev@localhost:5432/stratum",
  nodeEnv,
  jwtSecret: jwtSecretEnv || crypto.randomBytes(32).toString("hex"),
  jwtAudience: jwtAudienceEnv,
  jwtIssuer: jwtIssuerEnv,
  allowedOrigins: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
    : ["http://localhost:3000", "http://localhost:3300"],
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || "100"),
  rateLimitWindow: process.env.RATE_LIMIT_WINDOW || "1 minute",
  redisUrl: process.env.REDIS_URL || undefined,
};
