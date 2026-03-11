import { buildApp } from "./app.js";
import { config } from "./config.js";
import { migrate } from "./db/migrate.js";
import { closePool } from "./db/connection.js";

async function main(): Promise<void> {
  // Run database migrations
  console.log("Running migrations...");
  await migrate();

  // Build and start the app
  const app = await buildApp();

  await app.listen({ port: config.port, host: "0.0.0.0" });
  console.log(`Stratum Control Plane listening on port ${config.port} (${config.nodeEnv})`);

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`Received ${signal}, shutting down...`);
    try {
      await app.close();
      await closePool();
      console.log("Shutdown complete.");
      process.exit(0);
    } catch (err) {
      console.error("Error during shutdown:", err);
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
