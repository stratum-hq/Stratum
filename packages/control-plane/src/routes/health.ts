import { FastifyInstance } from "fastify";
import { getPool } from "../db/connection.js";

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
      let dbStatus: "connected" | "disconnected" = "disconnected";

      try {
        const pool = getPool();
        await pool.query("SELECT 1");
        dbStatus = "connected";
      } catch {
        dbStatus = "disconnected";
      }

      const redisStatus = await checkRedisHealth();

      reply.status(200).send({
        status: "ok",
        timestamp: new Date().toISOString(),
        db: dbStatus,
        redis: redisStatus,
      });
    });
  };
}
