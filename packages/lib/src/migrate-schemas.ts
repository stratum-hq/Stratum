import fs from "node:fs";
import path from "node:path";
import pg from "pg";

export interface MigrateSchemasOptions {
  pool: pg.Pool;
  concurrency?: number;
  onProgress?: (schema: string, index: number, total: number) => void;
  enforceRls?: boolean;
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
  const { pool, concurrency = 5, onProgress, enforceRls } = options;

  // Discover tenant schemas
  const { rows } = await pool.query<{ slug: string }>(
    `SELECT slug FROM tenants WHERE isolation_strategy = 'SCHEMA_PER_TENANT' AND (deleted_at IS NULL) ORDER BY slug`,
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

  const migrationSql = files.map((file) => ({
    name: file,
    sql: fs.readFileSync(path.join(migrationsDir, file), "utf-8"),
  }));

  // Simple semaphore for concurrency control
  let active = 0;
  let completed = 0;
  const queue = [...schemas];
  const promises: Promise<void>[] = [];

  function next(): Promise<void> | undefined {
    const schema = queue.shift();
    if (!schema) return undefined;

    active++;
    const p = migrateSchema(pool, schema, migrationSql, enforceRls)
      .then(() => {
        result.succeeded.push(schema);
      })
      .catch((err) => {
        result.failed.push({
          schema,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      })
      .finally(() => {
        active--;
        completed++;
        onProgress?.(schema, completed, schemas.length);
        const n = next();
        if (n) promises.push(n);
      });

    return p;
  }

  // Start up to `concurrency` workers
  for (let i = 0; i < Math.min(concurrency, schemas.length); i++) {
    const p = next();
    if (p) promises.push(p);
  }

  await Promise.all(promises);

  // Wait until all in-flight work is done (handles promises added in .finally)
  while (active > 0 || completed < schemas.length) {
    await Promise.all(promises);
  }

  return result;
}

async function migrateSchema(
  pool: pg.Pool,
  schema: string,
  migrations: { name: string; sql: string }[],
  enforceRls?: boolean,
): Promise<void> {
  // Use a hash of the schema name for a unique advisory lock key per schema
  const lockKey = hashSchemaLock(schema);

  for (const migration of migrations) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Advisory lock scoped to this schema
      await client.query(`SELECT pg_advisory_xact_lock($1)`, [lockKey]);

      // Set search_path to the tenant schema
      await client.query(`SET LOCAL search_path = ${quoteIdent(schema)}, public`);

      // Ensure _migrations table exists in this schema
      await client.query(`
        CREATE TABLE IF NOT EXISTS _migrations (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);

      // Check if already applied
      const { rows } = await client.query(
        "SELECT 1 FROM _migrations WHERE name = $1",
        [migration.name],
      );
      if (rows.length > 0) {
        await client.query("COMMIT");
        continue;
      }

      if (enforceRls) {
        await client.query("SET LOCAL stratum.enforce_rls = 'on'");
      }

      await client.query(migration.sql);
      await client.query("INSERT INTO _migrations (name) VALUES ($1)", [
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
  // Simple identifier quoting — disallow anything that could break out
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
    throw new Error(`Invalid schema name: ${name}`);
  }
  return `"${name}"`;
}
