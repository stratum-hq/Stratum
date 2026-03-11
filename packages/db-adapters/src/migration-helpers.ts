import pg from "pg";

// Validate table name to prevent SQL injection (only allows alphanumeric + underscores)
function validateTableName(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid table name: ${name}`);
  }
  return name;
}

export async function addTenantColumn(
  client: pg.PoolClient,
  tableName: string,
): Promise<void> {
  const safe = validateTableName(tableName);
  await client.query(
    `ALTER TABLE ${safe} ADD COLUMN tenant_id UUID NOT NULL`,
  );
}

export async function enableRLS(
  client: pg.PoolClient,
  tableName: string,
): Promise<void> {
  const safe = validateTableName(tableName);
  await client.query(`ALTER TABLE ${safe} ENABLE ROW LEVEL SECURITY`);
  await client.query(`ALTER TABLE ${safe} FORCE ROW LEVEL SECURITY`);
}

export async function createIsolationPolicy(
  client: pg.PoolClient,
  tableName: string,
): Promise<void> {
  const safe = validateTableName(tableName);
  await client.query(
    `CREATE POLICY tenant_isolation ON ${safe}
     USING (tenant_id = current_setting('app.current_tenant_id')::uuid)`,
  );
}

export async function migrateTable(
  client: pg.PoolClient,
  tableName: string,
): Promise<void> {
  await addTenantColumn(client, tableName);
  await enableRLS(client, tableName);
  await createIsolationPolicy(client, tableName);
}
