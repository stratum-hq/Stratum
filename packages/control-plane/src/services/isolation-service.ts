import { withTransaction } from "@stratum/lib";
import {
  createSchema,
  dropSchema,
  replicateTableToSchema,
  tenantSchemaName,
  createDatabase,
  databaseExists,
} from "@stratum/db-adapters";
import { getPool } from "../db/connection.js";

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
       USING (tenant_id = current_setting('app.current_tenant_id')::uuid)`,
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

export async function setupSchemaForTenant(
  tenantSlug: string,
  tables?: string[],
): Promise<void> {
  return withTransaction(getPool(), async (client) => {
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
  return withTransaction(getPool(), async (client) => {
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
  const pool = getPool();
  const client = await pool.connect();
  try {
    const exists = await databaseExists(client, tenantSlug);
    if (!exists) {
      await createDatabase(client, tenantSlug, templateDb);
    }
  } finally {
    client.release();
  }
}

/**
 * Tears down the DB_PER_TENANT isolation for a tenant.
 *
 * This closes any open connection pools for the tenant database but does NOT
 * drop the database — data preservation is left to the operator.
 * To actually drop the database, use dropDatabase() from @stratum/db-adapters directly.
 */
export async function teardownDatabaseForTenant(_tenantSlug: string): Promise<void> {
  // Pool cleanup is managed externally via DatabasePoolManager.closePool().
  // This function is intentionally a no-op at the isolation-service level
  // so that callers can decide whether to drop the database independently.
}
