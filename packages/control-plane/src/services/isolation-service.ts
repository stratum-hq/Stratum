import { withTransaction } from "@stratum-hq/lib";
import {
  createSchema,
  dropSchema,
  replicateTableToSchema,
  tenantSchemaName,
  createDatabase,
  databaseExists,
  dropDatabase,
} from "@stratum-hq/db-adapters";
import { getPool, getStratumPool } from "../db/connection.js";

const registeredTables: Set<string> = new Set();

// Validate table name to prevent SQL injection (only allows alphanumeric + underscores)
function validateTableName(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid table name: ${name}`);
  }
  return name;
}

export function registerTable(tableName: string): void {
  registeredTables.add(validateTableName(tableName));
}

export async function setupRLSForTable(tableName: string): Promise<void> {
  const safe = validateTableName(tableName);
  return withTransaction(getPool(), async (client) => {
    await client.query(
      `ALTER TABLE ${safe} ENABLE ROW LEVEL SECURITY`,
    );
    await client.query(
      `ALTER TABLE ${safe} FORCE ROW LEVEL SECURITY`,
    );
    await client.query(
      `CREATE POLICY tenant_isolation ON ${safe}
       USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)`,
    );
  });
}

export async function teardownRLSForTable(tableName: string): Promise<void> {
  const safe = validateTableName(tableName);
  return withTransaction(getPool(), async (client) => {
    await client.query(
      `DROP POLICY IF EXISTS tenant_isolation ON ${safe}`,
    );
    await client.query(
      `ALTER TABLE ${safe} DISABLE ROW LEVEL SECURITY`,
    );
  });
}

export async function setupAllRLS(): Promise<void> {
  for (const tableName of registeredTables) {
    await setupRLSForTable(tableName);
  }
}

// Schemas and databases of isolated tenants are created and dropped on the
// admin pool when DATABASE_ADMIN_URL is set (it needs CREATE on the database,
// or CREATEDB), else on the application pool. The table-level RLS helpers
// above change application tables, so they run as the application login,
// which owns them.

export async function setupSchemaForTenant(
  tenantSlug: string,
  tables?: string[],
): Promise<void> {
  return withTransaction(getStratumPool(), async (client) => {
    await createSchema(client, tenantSlug);
    if (tables && tables.length > 0) {
      const schemaName = tenantSchemaName(tenantSlug);
      for (const tableName of tables) {
        await replicateTableToSchema(client, validateTableName(tableName), schemaName);
      }
    }
  });
}

export async function teardownSchemaForTenant(tenantSlug: string): Promise<void> {
  return withTransaction(getStratumPool(), async (client) => {
    await dropSchema(client, tenantSlug);
  });
}

/**
 * Creates the dedicated database for a DB_PER_TENANT tenant.
 *
 * CREATE DATABASE cannot run inside a transaction, so this function uses a
 * standalone client from the pool (no BEGIN/COMMIT wrapping).
 */
export async function setupDatabaseForTenant(
  tenantSlug: string,
  templateDb?: string,
): Promise<void> {
  const pool = getStratumPool();
  const client = await pool.connect();
  try {
    // Never adopt an existing database: it may hold another tenant's data.
    if (await databaseExists(client, tenantSlug)) {
      throw new Error(`Database for tenant slug "${tenantSlug}" already exists`);
    }
    await createDatabase(client, tenantSlug, templateDb);
  } finally {
    client.release();
  }
}

/**
 * Drops the dedicated database of a DB_PER_TENANT tenant, named exactly as
 * {@link setupDatabaseForTenant} names it. Purging a tenant already does this;
 * close any pools to the tenant database first, or the drop fails.
 *
 * DROP DATABASE cannot run inside a transaction, so like setup this uses a
 * standalone client from the pool.
 */
export async function teardownDatabaseForTenant(tenantSlug: string): Promise<void> {
  const client = await getStratumPool().connect();
  try {
    await dropDatabase(client, tenantSlug);
  } finally {
    client.release();
  }
}
