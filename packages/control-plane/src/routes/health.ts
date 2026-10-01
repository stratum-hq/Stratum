import { FastifyInstance } from "fastify";
import { getAdminPool, getPool } from "../db/connection.js";

async function poolStatus(pool: { query: (sql: string) => Promise<unknown> }): Promise<"connected" | "disconnected"> {
  try {
    await pool.query("SELECT 1");
    return "connected";
  } catch {
    return "disconnected";
  }
}

type RedisHealthChecker = () => Promise<"connected" | "disconnected" | "not_configured">;

/**
 * Health routes factory. Accepts an optional Redis health checker so the
 * health endpoint can report Redis status without a hard dependency on it.
 */
export function healthRoutes(
  checkRedisHealth: RedisHealthChecker,
) {
  return async function healthRoutesPlugin(app: FastifyInstance): Promise<void> {
    app.get("/api/v1/health", async (_request, reply) => {
      const dbStatus = await poolStatus(getPool());
      // Reported only when DATABASE_ADMIN_URL is set.
      const adminPool = getAdminPool();
      const adminStatus = adminPool ? await poolStatus(adminPool) : undefined;

      const redisStatus = await checkRedisHealth();

      reply.status(200).send({
        status: "ok",
        timestamp: new Date().toISOString(),
        db: dbStatus,
        ...(adminStatus ? { admin_db: adminStatus } : {}),
        redis: redisStatus,
      });
    });
  };
}
