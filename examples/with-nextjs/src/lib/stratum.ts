/**
 * Singleton Stratum instance for Next.js.
 *
 * In Next.js, module-level singletons are safe because the server process
 * persists across requests. We guard against re-initialization with a
 * module-level promise so concurrent requests don't race on startup.
 */
import pg from "pg";
import { Stratum } from "@stratum-hq/lib";

// Re-use the Pool across hot-reloads in development via globalThis.
// See: https://www.prisma.io/docs/guides/performance-and-optimization/connection-management
const globalForStratum = globalThis as unknown as {
  _stratumPool: pg.Pool | undefined;
  _stratumInstance: Stratum | undefined;
};

const pool =
  globalForStratum._stratumPool ??
  new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
  });

const stratumInstance =
  globalForStratum._stratumInstance ??
  new Stratum({
    pool,
    autoMigrate: true,
    // Set enforceRls: true in production to prevent BYPASSRLS misconfiguration.
    enforceRls: process.env.NODE_ENV === "production",
  });

if (process.env.NODE_ENV !== "production") {
  globalForStratum._stratumPool = pool;
  globalForStratum._stratumInstance = stratumInstance;
}

// Initialize once — subsequent calls are no-ops.
await stratumInstance.initialize();

export { stratumInstance as stratum, pool };
