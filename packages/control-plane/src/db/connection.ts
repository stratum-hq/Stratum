import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | null = null;
let adminPool: pg.Pool | null = null;

// Note: pg.Pool has no built-in queue depth limit. Under heavy load, excess
// requests queue in memory until connectionTimeoutMillis elapses. Keep
// connectionTimeoutMillis short so queued requests fail fast rather than
// accumulating and exhausting the event loop.
function createPool(connectionString: string): pg.Pool {
  return new Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
    allowExitOnIdle: true,
  });
}

/** The application login's pool, from DATABASE_URL. */
export function getPool(): pg.Pool {
  if (!pool) {
    pool = createPool(
      process.env.DATABASE_URL ||
        "postgres://stratum_app:stratum_dev@localhost:5432/stratum",
    );
  }
  return pool;
}

/**
 * The admin login's pool, from DATABASE_ADMIN_URL, or undefined when it is
 * not set. The admin login is a member of the control role of
 * @stratum-hq/lib migration 032: the library, the migrations and the
 * isolation service run on it, and the library sets no app.bypass_rls.
 */
export function getAdminPool(): pg.Pool | undefined {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) return undefined;
  if (!adminPool) adminPool = createPool(url);
  return adminPool;
}

/** The pool for Stratum's own work: the admin pool when configured, else the application pool. */
export function getStratumPool(): pg.Pool {
  return getAdminPool() ?? getPool();
}

export async function closePool(): Promise<void> {
  if (adminPool) {
    await adminPool.end();
    adminPool = null;
  }
  if (pool) {
    await pool.end();
    pool = null;
  }
}
