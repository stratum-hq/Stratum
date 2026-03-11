import { connectDb, scanTables, type TableInfo } from "../utils/db.js";
import { confirm } from "../utils/prompt.js";
import * as log from "../utils/log.js";

function validateTableName(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid table name: "${name}". Only letters, digits, and underscores allowed.`);
  }
  return name;
}

async function migrateTable(
  pool: import("pg").Pool,
  tableName: string,
  info?: TableInfo,
): Promise<void> {
  const safe = validateTableName(tableName);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Check if table exists
    const exists = await client.query(
      "SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = $1",
      [safe],
    );
    if (exists.rows.length === 0) {
      throw new Error(`Table "${safe}" does not exist in the public schema`);
    }

    // Add tenant_id if missing
    if (!info || !info.has_tenant_id) {
      const hasCol = await client.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'tenant_id'`,
        [safe],
      );
      if (hasCol.rows.length === 0) {
        log.info(`Adding tenant_id column to ${safe}...`);
        await client.query(
          `ALTER TABLE ${safe} ADD COLUMN tenant_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'`,
        );
        // Remove default after adding (the default is just to allow adding NOT NULL to existing rows)
        await client.query(`ALTER TABLE ${safe} ALTER COLUMN tenant_id DROP DEFAULT`);
        log.success(`Added tenant_id column to ${safe}`);
      } else {
        log.info(`${safe} already has tenant_id column`);
      }
    }

    // Enable RLS
    if (!info || !info.rls_enabled) {
      log.info(`Enabling RLS on ${safe}...`);
      await client.query(`ALTER TABLE ${safe} ENABLE ROW LEVEL SECURITY`);
      await client.query(`ALTER TABLE ${safe} FORCE ROW LEVEL SECURITY`);
      log.success(`RLS enabled on ${safe}`);
    } else if (!info.rls_forced) {
      await client.query(`ALTER TABLE ${safe} FORCE ROW LEVEL SECURITY`);
      log.success(`FORCE RLS enabled on ${safe}`);
    }

    // Create isolation policy
    if (!info || !info.has_policy) {
      log.info(`Creating tenant_isolation policy on ${safe}...`);
      await client.query(
        `CREATE POLICY tenant_isolation ON ${safe}
         USING (tenant_id = current_setting('app.current_tenant_id')::uuid)`,
      );
      log.success(`tenant_isolation policy created on ${safe}`);
    }

    // Add index on tenant_id
    const idxName = `idx_${safe}_tenant_id`;
    const hasIdx = await client.query(
      "SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1",
      [idxName],
    );
    if (hasIdx.rows.length === 0) {
      await client.query(`CREATE INDEX ${idxName} ON ${safe}(tenant_id)`);
      log.success(`Index ${idxName} created`);
    }

    // Add FK to tenants table if it exists
    const hasTenants = await client.query(
      "SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'tenants'",
    );
    if (hasTenants.rows.length > 0) {
      const fkName = `fk_${safe}_tenant_id`;
      const hasFk = await client.query(
        "SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = $1",
        [fkName],
      );
      if (hasFk.rows.length === 0) {
        await client.query(
          `ALTER TABLE ${safe} ADD CONSTRAINT ${fkName}
           FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE`,
        );
        log.success(`Foreign key ${fkName} created`);
      }
    }

    await client.query("COMMIT");
    log.success(`Migration complete for ${safe}`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function migrate(
  args: string[],
  flags: Record<string, string | boolean>,
): Promise<void> {
  const pool = await connectDb(flags);

  try {
    if (flags["scan"]) {
      // Scan mode
      log.heading("Database Table Scan");
      const tables = await scanTables(pool);

      if (tables.length === 0) {
        log.info("No user tables found in the public schema.");
        return;
      }

      const header = ["Table", "tenant_id", "RLS", "FORCE", "Policy", "Status"];
      const rows = tables.map((t) => {
        const ready = t.has_tenant_id && t.rls_enabled && t.rls_forced && t.has_policy;
        return [
          t.table_name,
          t.has_tenant_id ? "yes" : "—",
          t.rls_enabled ? "yes" : "—",
          t.rls_forced ? "yes" : "—",
          t.has_policy ? "yes" : "—",
          ready ? "\x1b[32mready\x1b[0m" : "\x1b[33mneeds migration\x1b[0m",
        ];
      });
      log.table([header, ...rows]);

      const unmigrated = tables.filter(
        (t) => !t.has_tenant_id || !t.rls_enabled || !t.has_policy,
      );
      if (unmigrated.length > 0) {
        console.log();
        log.info(`${unmigrated.length} table(s) need migration:`);
        unmigrated.forEach((t) => log.dim(`  stratum migrate ${t.table_name}`));
      } else {
        console.log();
        log.success("All tables are fully migrated!");
      }
    } else if (flags["all"]) {
      // Migrate all unmigrated tables
      log.heading("Migrate All Tables");
      const tables = await scanTables(pool);
      const unmigrated = tables.filter(
        (t) => !t.has_tenant_id || !t.rls_enabled || !t.has_policy,
      );

      if (unmigrated.length === 0) {
        log.success("All tables are already migrated!");
        return;
      }

      log.info(`Found ${unmigrated.length} table(s) to migrate:`);
      unmigrated.forEach((t) => log.dim(`  ${t.table_name}`));
      console.log();

      const proceed = await confirm("Proceed with migration?");
      if (!proceed) {
        log.info("Cancelled.");
        return;
      }

      for (const table of unmigrated) {
        console.log();
        log.heading(`Migrating: ${table.table_name}`);
        await migrateTable(pool, table.table_name, table);
      }

      console.log();
      log.success(`Migrated ${unmigrated.length} table(s).`);
    } else if (args.length > 0) {
      // Migrate specific table
      const tableName = args[0];
      log.heading(`Migrate: ${tableName}`);

      const tables = await scanTables(pool);
      const info = tables.find((t) => t.table_name === tableName);

      if (info && info.has_tenant_id && info.rls_enabled && info.rls_forced && info.has_policy) {
        log.success(`${tableName} is already fully migrated.`);
        return;
      }

      const proceed = await confirm(
        `Add tenant_id + RLS + isolation policy to "${tableName}"?`,
      );
      if (!proceed) {
        log.info("Cancelled.");
        return;
      }

      await migrateTable(pool, tableName, info);
    } else {
      console.error("Usage: stratum migrate <table> | --scan | --all");
      process.exit(1);
    }

    console.log();
  } finally {
    await pool.end();
  }
}
