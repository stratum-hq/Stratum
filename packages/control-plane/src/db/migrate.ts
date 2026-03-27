import { migrate as runMigrations } from "@stratum-hq/lib";
import { getPool } from "./connection.js";

async function migrate(): Promise<void> {
  const pool = getPool();
  console.log("Running migrations...");
  await runMigrations({ pool, enforceRls: process.env.NODE_ENV === "production" });
  console.log("Migrations complete.");
}

export { migrate };
