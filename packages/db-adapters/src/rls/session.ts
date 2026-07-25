import pg from "pg";

export async function setTenantContext(
  client: pg.PoolClient,
  tenantId: string,
): Promise<void> {
  await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
}

export async function resetTenantContext(client: pg.PoolClient): Promise<void> {
  await client.query("SELECT set_config('app.current_tenant_id', '', true)");
}

export async function withTenantContext<T>(
  pool: pg.Pool,
  tenantId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await setTenantContext(client, tenantId);
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

/**
 * Runs `fn` inside a transaction with the RLS bypass flag set, so control-plane
 * / system operations that legitimately span tenant boundaries (provisioning,
 * cascade ops, ancestry reads) can see and write all rows.
 *
 * The flag is set with `SET LOCAL` semantics (set_config third arg `true`), so it
 * is transaction scoped and cannot leak into a later request that reuses the same
 * pooled connection. This is the audited system path referenced by the RLS
 * policies (which admit `current_setting('app.bypass_rls', true) = 'on'`).
 *
 * Use sparingly and only for operations that are known to require cross-tenant
 * access. Tenant-scoped work should use `withTenantContext` instead.
 */
export async function withRlsBypass<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.bypass_rls', 'on', true)");
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

export async function getCurrentTenantId(
  client: pg.PoolClient,
): Promise<string | null> {
  const res = await client.query<{ current_setting: string }>(
    `SELECT current_setting('app.current_tenant_id', true) AS current_setting`,
  );
  const value = res.rows[0]?.current_setting;
  return value || null;
}
