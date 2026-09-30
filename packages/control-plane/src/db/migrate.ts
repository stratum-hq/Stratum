import { migrate as runMigrations } from "@stratum-hq/lib";
import { getPool } from "./connection.js";

async function migrate(): Promise<void> {
  const pool = getPool();
  console.log("Running migrations...");
  // RLS is enforced everywhere except local development and test runs (an
  // unset NODE_ENV counts as development), matching the JWT_SECRET checks.
  const nodeEnv = process.env.NODE_ENV || "development";
  const enforceRls = nodeEnv !== "development" && nodeEnv !== "test";
  await runMigrations({ pool, enforceRls });
  console.log("Migrations complete.");
}

export { migrate };
