import { FastifyInstance } from "fastify";
import { getPool } from "../db/connection.js";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/health", async (_request, reply) => {
    let dbStatus: "connected" | "disconnected" = "disconnected";

    try {
      const pool = getPool();
      await pool.query("SELECT 1");
      dbStatus = "connected";
    } catch {
      dbStatus = "disconnected";
    }

    reply.status(200).send({
      status: "ok",
      timestamp: new Date().toISOString(),
      db: dbStatus,
    });
  });
}
