import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    // Note: pg.Pool has no built-in queue depth limit. Under heavy load,
    // excess requests queue in memory until connectionTimeoutMillis elapses.
    // Keep connectionTimeoutMillis short so queued requests fail fast rather
    // than accumulating and exhausting the event loop.
    pool = new Pool({
      connectionString:
        process.env.DATABASE_URL ||
        "postgres://stratum_app:stratum_dev@localhost:5432/stratum",
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
      allowExitOnIdle: true,
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
