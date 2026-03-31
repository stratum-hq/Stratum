// Integration test setup — connects to real MySQL
// Requires MYSQL_URL environment variable (set by CI or local docker)
import { createPool } from "mysql2/promise";

const MYSQL_URL = process.env.MYSQL_URL || "mysql://root@localhost:3306";
const MYSQL_TEST_DB = process.env.MYSQL_TEST_DB || "stratum_test";

let pool: Awaited<ReturnType<typeof createPool>> | undefined;

export async function getTestPool(): Promise<ReturnType<typeof createPool>> {
  if (!pool) {
    pool = createPool(MYSQL_URL);
  }
  return pool;
}

export function getTestDbName(): string {
  return MYSQL_TEST_DB;
}

export async function cleanupTestPool(): Promise<void> {
  if (pool) {
    await pool.end();
  }
}
