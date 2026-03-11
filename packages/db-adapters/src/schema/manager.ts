import pg from "pg";

// Validate schema name to prevent SQL injection (only allows alphanumeric + underscores)
function validateSchemaName(schemaName: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schemaName)) {
    throw new Error(`Invalid schema name: ${schemaName}`);
  }
  return schemaName;
}

// Validate table name to prevent SQL injection (only allows alphanumeric + underscores)
function validateTableName(tableName: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
    throw new Error(`Invalid table name: ${tableName}`);
  }
  return tableName;
}

export function tenantSchemaName(tenantSlug: string): string {
  return `tenant_${tenantSlug}`;
}

export async function createSchema(
  client: pg.PoolClient,
  tenantSlug: string,
): Promise<void> {
  const schemaName = validateSchemaName(tenantSchemaName(tenantSlug));
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`);
}

export async function dropSchema(
  client: pg.PoolClient,
  tenantSlug: string,
): Promise<void> {
  const schemaName = validateSchemaName(tenantSchemaName(tenantSlug));
  await client.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
}

export async function schemaExists(
  client: pg.PoolClient,
  tenantSlug: string,
): Promise<boolean> {
  const schemaName = tenantSchemaName(tenantSlug);
  const res = await client.query<{ count: string }>(
    `SELECT count(*) FROM pg_namespace WHERE nspname = $1`,
    [schemaName],
  );
  return parseInt(res.rows[0].count, 10) > 0;
}

export async function listTenantSchemas(
  client: pg.PoolClient,
): Promise<string[]> {
  const res = await client.query<{ nspname: string }>(
    `SELECT nspname FROM pg_namespace WHERE nspname LIKE 'tenant_%' ORDER BY nspname`,
  );
  return res.rows.map((r) => r.nspname);
}

export async function replicateTableToSchema(
  client: pg.PoolClient,
  tableName: string,
  schemaName: string,
): Promise<void> {
  const safeTable = validateTableName(tableName);
  const safeSchema = validateSchemaName(schemaName);
  await client.query(
    `CREATE TABLE IF NOT EXISTS ${safeSchema}.${safeTable} (LIKE public.${safeTable} INCLUDING ALL)`,
  );
}
