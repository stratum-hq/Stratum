import pg from "pg";
import { validateSlug } from "@stratum-hq/core";

const DB_PREFIX = "stratum_tenant_";

/**
 * Returns the database name for a given tenant slug.
 * Format: stratum_tenant_{slug}
 */
export function getDatabaseName(tenantSlug: string): string {
  validateSlug(tenantSlug);
  return `${DB_PREFIX}${tenantSlug}`;
}

/**
 * Checks whether the per-tenant database exists.
 * Safe to run inside a transaction (uses pg_database catalog).
 */
export async function databaseExists(
  client: pg.PoolClient | pg.Client,
  tenantSlug: string,
): Promise<boolean> {
  const dbName = getDatabaseName(tenantSlug);
  const res = await client.query<{ exists: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS exists`,
    [dbName],
  );
  return res.rows[0].exists;
}

/**
 * Creates the per-tenant database.
 *
 * IMPORTANT: CREATE DATABASE cannot run inside a transaction block.
 * The caller MUST provide a pg.Client (not a pool client inside a transaction)
 * with autocommit behavior. Typically obtained via pool.connect() without BEGIN.
 */
export async function createDatabase(
  client: pg.PoolClient | pg.Client,
  tenantSlug: string,
  templateDb?: string,
): Promise<void> {
  const dbName = getDatabaseName(tenantSlug);
  // Identifiers validated by regex — no user-supplied interpolation outside of validated values.
  // pg does not support parameterized DDL identifiers, so we construct the SQL string directly.
  let sql = `CREATE DATABASE "${dbName}"`;
  if (templateDb) {
    // Template DB name must only contain safe identifier characters.
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(templateDb)) {
      throw new Error(`Invalid template database name: "${templateDb}"`);
    }
    sql += ` TEMPLATE "${templateDb}"`;
  }
  await client.query(sql);
}

/**
 * Drops the per-tenant database if it exists.
 *
 * IMPORTANT: DROP DATABASE cannot run inside a transaction block.
 * Same constraint as createDatabase — use a standalone client.
 */
export async function dropDatabase(
  client: pg.PoolClient | pg.Client,
  tenantSlug: string,
): Promise<void> {
  const dbName = getDatabaseName(tenantSlug);
  await client.query(`DROP DATABASE IF EXISTS "${dbName}"`);
}
