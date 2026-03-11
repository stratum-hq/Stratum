import pg from "pg";

// Validate table name to prevent SQL injection (only allows alphanumeric + underscores)
function validateTableName(tableName: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
    throw new Error(`Invalid table name: ${tableName}`);
  }
  return tableName;
}

export async function createPolicy(
  client: pg.PoolClient,
  tableName: string,
): Promise<void> {
  const safe = validateTableName(tableName);
  // Cannot use parameterized queries inside DO blocks or for DDL identifiers.
  // Table name is validated via allowlist regex above.
  const exists = await client.query<{ count: string }>(
    `SELECT count(*) FROM pg_policies WHERE tablename = $1 AND policyname = 'tenant_isolation'`,
    [safe],
  );
  if (parseInt(exists.rows[0].count, 10) === 0) {
    await client.query(
      `CREATE POLICY tenant_isolation ON ${safe} USING (tenant_id = current_setting('app.current_tenant_id')::uuid)`,
    );
  }
}

export async function dropPolicy(
  client: pg.PoolClient,
  tableName: string,
): Promise<void> {
  const safe = validateTableName(tableName);
  await client.query(`DROP POLICY IF EXISTS tenant_isolation ON ${safe}`);
}

export async function enableRLS(
  client: pg.PoolClient,
  tableName: string,
): Promise<void> {
  const safe = validateTableName(tableName);
  await client.query(`ALTER TABLE ${safe} ENABLE ROW LEVEL SECURITY`);
  await client.query(`ALTER TABLE ${safe} FORCE ROW LEVEL SECURITY`);
}

export async function disableRLS(
  client: pg.PoolClient,
  tableName: string,
): Promise<void> {
  const safe = validateTableName(tableName);
  await client.query(`ALTER TABLE ${safe} NO FORCE ROW LEVEL SECURITY`);
  await client.query(`ALTER TABLE ${safe} DISABLE ROW LEVEL SECURITY`);
}

export async function isRLSEnabled(
  client: pg.PoolClient,
  tableName: string,
): Promise<boolean> {
  const res = await client.query<{ relrowsecurity: boolean }>(
    `SELECT relrowsecurity FROM pg_class WHERE relname = $1`,
    [tableName],
  );
  if (res.rows.length === 0) {
    return false;
  }
  return res.rows[0].relrowsecurity;
}
