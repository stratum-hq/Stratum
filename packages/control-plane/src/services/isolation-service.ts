import { withTransaction } from "@stratum/lib";
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
