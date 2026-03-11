const jwtSecretEnv = process.env.JWT_SECRET;
const nodeEnv = process.env.NODE_ENV || "development";

if (!jwtSecretEnv) {
  if (nodeEnv === "production") {
    console.warn(
      "\n" +
      "╔══════════════════════════════════════════════════════════════╗\n" +
      "║                  ⚠  SECURITY WARNING  ⚠                    ║\n" +
      "║                                                              ║\n" +
      "║  JWT_SECRET is not set in a PRODUCTION environment!         ║\n" +
      "║  A hardcoded dev fallback is being used. This is INSECURE.  ║\n" +
      "║  Set the JWT_SECRET environment variable immediately.        ║\n" +
      "╚══════════════════════════════════════════════════════════════╝\n"
    );
  } else {
    console.warn("[stratum] JWT_SECRET not set — using dev fallback. Set JWT_SECRET before deploying to production.");
  }
}

export const config = {
  port: parseInt(process.env.PORT || "3001"),
  databaseUrl: process.env.DATABASE_URL || "postgres://stratum:stratum_dev@localhost:5432/stratum",
  nodeEnv,
  jwtSecret: jwtSecretEnv || "dev-secret-change-in-production",
  allowedOrigins: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
    : ["http://localhost:3000", "http://localhost:3300"],
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || "100"),
  rateLimitWindow: process.env.RATE_LIMIT_WINDOW || "1 minute",
};
