import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { withClient } from "./pool-helpers.js";
import { assertRoleName, isSuperuser, migrationSql, setApplyControlRole, setControlRole } from "./migration-sql.js";
import { assertRoleSubjectToRls } from "./migrate.js";

export interface MigrateSchemasOptions {
  pool: pg.Pool;
  concurrency?: number;
  onProgress?: (schema: string, index: number, total: number) => void;
  enforceRls?: boolean;
  /** The control role for migration 032; see MigrateOptions.controlRole. */
  controlRole?: string;
  /** Lets migration 032 grant the control role to the login of `pool`; see MigrateOptions.applyControlRole. */
  applyControlRole?: boolean;
}

export interface MigrateSchemasResult {
  succeeded: string[];
  failed: { schema: string; error: Error }[];
}

/**
 * Discover all tenant schemas (tenants with SCHEMA_PER_TENANT isolation)
 * and run the standard migration set against each one.
 *
 * Continues on error: schemas that fail are collected in result.failed[].
 */
export async function migrateAllSchemas(
  options: MigrateSchemasOptions,
): Promise<MigrateSchemasResult> {
  const { pool, concurrency = 5, onProgress, enforceRls, controlRole, applyControlRole } = options;
  if (controlRole !== undefined) assertRoleName(controlRole, "control role");

  if (enforceRls) {
    await assertRoleSubjectToRls(pool);
  }

  // Discover tenant schemas. The tenants registry is under FORCE RLS, so
  // discovery runs under the control-plane bypass like every other lib read.
  const { rows } = await withClient(pool, (client) =>
    client.query<{ slug: string }>(
      `SELECT slug FROM tenants WHERE isolation_strategy = 'SCHEMA_PER_TENANT' AND (deleted_at IS NULL) ORDER BY slug`,
    ),
  );

  const schemas = rows.map((r) => `tenant_${r.slug}`);
  const result: MigrateSchemasResult = { succeeded: [], failed: [] };

  if (schemas.length === 0) {
    return result;
  }

  // Load migration files once
  const migrationsDir = path.resolve(__dirname, "migrations");
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(
      `Migration files not found at ${migrationsDir}. Ensure the package was built with 'npm run build'.`,
    );
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const superuser = await isSuperuser(pool);
  const migrations = files.map((file) => ({
    name: file,
    sql: migrationSql(file, fs.readFileSync(path.join(migrationsDir, file), "utf-8"), superuser),
  }));

  // Process schemas in chunks of `concurrency` size
  let completed = 0;
  for (let i = 0; i < schemas.length; i += concurrency) {
    const chunk = schemas.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      chunk.map((schema) => migrateSchema(pool, schema, migrations, enforceRls, controlRole, applyControlRole)),
    );

    for (let j = 0; j < results.length; j++) {
      const schema = chunk[j];
      const outcome = results[j];
      if (outcome.status === "fulfilled") {
        result.succeeded.push(schema);
      } else {
        const err = outcome.reason;
        result.failed.push({
          schema,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
      completed++;
      onProgress?.(schema, completed, schemas.length);
    }
  }

  return result;
}

async function migrateSchema(
  pool: pg.Pool,
  schema: string,
  migrations: { name: string; sql: string }[],
  enforceRls?: boolean,
  controlRole?: string,
  applyControlRole?: boolean,
): Promise<void> {
  // Use a hash of the schema name for a unique advisory lock key per schema
  const lockKey = hashSchemaLock(schema);
  const quoted = quoteIdent(schema);

  for (const migration of migrations) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Advisory lock scoped to this schema
      await client.query(`SELECT pg_advisory_xact_lock($1)`, [lockKey]);

      // Set search_path to the tenant schema. public stays on the path because
      // the migration SQL uses extension types and functions installed there
      // (ltree, uuid_generate_v4).
      await client.query(`SET LOCAL search_path = ${quoted}, public`);

      // Ensure _migrations exists in this schema. It is schema-qualified so the
      // bookkeeping can never resolve to public._migrations; if the tenant
      // schema does not exist this fails and the schema is reported as failed.
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${quoted}._migrations (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);

      // Check if already applied
      const { rows } = await client.query(
        `SELECT 1 FROM ${quoted}._migrations WHERE name = $1`,
        [migration.name],
      );
      if (rows.length > 0) {
        await client.query("COMMIT");
        continue;
      }

      if (enforceRls) {
        await client.query("SET LOCAL stratum.enforce_rls = 'on'");
      }
      await setControlRole(client, controlRole);
      await setApplyControlRole(client, applyControlRole);

      await client.query(migration.sql);
      await client.query(`INSERT INTO ${quoted}._migrations (name) VALUES ($1)`, [
        migration.name,
      ]);
      await client.query("COMMIT");
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore rollback failure */
      }
      throw err;
    } finally {
      client.release();
    }
  }
}

/**
 * Produce a stable int32 advisory lock key from a schema name.
 * Uses a simple djb2-style hash.
 */
function hashSchemaLock(schema: string): number {
  let hash = 5381;
  for (let i = 0; i < schema.length; i++) {
    hash = ((hash << 5) + hash + schema.charCodeAt(i)) | 0;
  }
  // Offset from the base migrate lock (8675309) to avoid collision
  return (hash ^ 0x5354524d) | 0; // XOR with "STRM"
}

function quoteIdent(name: string): string {
  // Simple identifier quoting: disallow anything that could break out
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
    throw new Error(`Invalid schema name: ${name}`);
  }
  // PostgreSQL truncates longer identifiers, which could name another schema.
  if (Buffer.byteLength(name) > 63) {
    throw new Error(`Schema name exceeds 63 bytes: ${name}`);
  }
  return `"${name}"`;
}
