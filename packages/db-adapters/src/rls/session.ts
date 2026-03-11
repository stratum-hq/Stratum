import pg from "pg";

export async function setTenantContext(
  client: pg.PoolClient,
  tenantId: string,
): Promise<void> {
  await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
}

export async function resetTenantContext(client: pg.PoolClient): Promise<void> {
  await client.query("RESET app.current_tenant_id");
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
