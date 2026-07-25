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

async function enterBypass(client: pg.PoolClient): Promise<void> {
  // SET LOCAL (not session SET) so the flag is transaction scoped and cannot
  // leak across pooled connections. Equivalent to
  // set_config('app.bypass_rls', 'on', true).
  await client.query("SET LOCAL app.bypass_rls = 'on'");
}

export async function withClient<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await enterBypass(client);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function withTransaction<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await enterBypass(client);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
