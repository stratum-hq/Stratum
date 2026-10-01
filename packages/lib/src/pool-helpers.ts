import pg from "pg";

// The Stratum library is the trusted CONTROL PLANE: it manages the whole tenant
// tree (authenticating keys before any tenant is known, resolving inherited
// config up the ancestry chain, listing descendants, moving subtrees, cascade
// ops). By construction it reads and writes across tenant boundaries, so it runs
// under the RLS bypass.
//
// Both helpers open a transaction and issue `SET LOCAL app.bypass_rls = 'on'`
// before running the caller's work. SET LOCAL (set_config third arg `true`) is
// transaction scoped, so the flag cannot leak into a later request that reuses
// the same pooled connection. Row-level security stays enforced on the separate
// data-plane path (packages/db-adapters, withTenantContext); see
// docs/adr/0001-postgres-rls-defense-in-depth.md.
//
// This is the single chokepoint for all lib database access: every service goes
// through withClient / withTransaction, so no service function needs to change.
//
// A pool given to Stratum as `adminPool` logs in as a member of the control
// role (migration 032), whose stratum_control_plane policies admit every row.
// Such a pool needs no bypass setting, so the helpers do not set it there. A
// misconfigured admin login then fails closed instead of falling back on the
// legacy setting.

const adminPools = new WeakSet<pg.Pool>();

/** Marks `pool` as an admin pool: the helpers do not set app.bypass_rls on it. */
export function markAdminPool(pool: pg.Pool): void {
  adminPools.add(pool);
}

async function enterBypass(pool: pg.Pool, client: pg.PoolClient): Promise<void> {
  if (adminPools.has(pool)) return;
  // SET LOCAL (not session SET) so the flag is transaction scoped and cannot
  // leak across pooled connections. Equivalent to
  // set_config('app.bypass_rls', 'on', true).
  await client.query("SET LOCAL app.bypass_rls = 'on'");
}

// A failed ROLLBACK must not replace the caller's error. Callers map error
// codes such as 23505, so the original error must reach them unchanged. The
// ROLLBACK error goes to client.release instead: a truthy argument makes
// pg-pool destroy the connection, so no later caller gets a connection in an
// unknown transaction state.
async function rollback(client: pg.PoolClient): Promise<Error | undefined> {
  try {
    await client.query("ROLLBACK");
    return undefined;
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}

export async function withClient<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let rollbackErr: Error | undefined;
  try {
    await client.query("BEGIN");
    await enterBypass(pool, client);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    rollbackErr = await rollback(client);
    throw err;
  } finally {
    client.release(rollbackErr);
  }
}

export async function withTransaction<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let rollbackErr: Error | undefined;
  try {
    await client.query("BEGIN");
    await enterBypass(pool, client);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    rollbackErr = await rollback(client);
    throw err;
  } finally {
    client.release(rollbackErr);
  }
}
