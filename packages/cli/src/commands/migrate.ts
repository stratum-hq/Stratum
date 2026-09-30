import { STRATUM_TABLES } from "@stratum-hq/lib";
import { connectDb, scanTables, type TableInfo } from "../utils/db.js";
import { confirm } from "../utils/prompt.js";
import * as log from "../utils/log.js";

function validateTableName(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid table name: "${name}". Only letters, digits, and underscores allowed.`);
  }
  return name;
}

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

/**
 * Returns the tenant that `--tenant` names, or undefined when the flag is absent.
 * Throws when the flag has no value, is not a UUID, or is the nil UUID.
 */
function parseTenantFlag(flags: Record<string, string | boolean>): string | undefined {
  const value = flags["tenant"];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error("--tenant needs a value: --tenant <uuid>");
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`Invalid --tenant value: "${value}". Expected a UUID.`);
  }
  // Rows assigned to the nil UUID belong to no real tenant.
  if (value === NIL_UUID) {
    throw new Error("--tenant cannot be the nil UUID. Give the id of a real tenant.");
  }
  return value;
}

/** Throws unless `tenantId` is a row in the tenants table, when that table exists. */
async function assertTenantExists(
  client: import("pg").PoolClient,
  tenantId: string,
): Promise<void> {
  const hasTenants = await client.query(
    "SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'tenants'",
  );
  if (hasTenants.rows.length === 0) return;

  // Stratum's tenants table has FORCE RLS, so the lookup needs the bypass. The
  // bypass is switched off again so that it does not apply to the rest of the migration.
  await client.query("SELECT set_config('app.bypass_rls', 'on', true)");
  const found = await client.query("SELECT 1 FROM tenants WHERE id = $1", [tenantId]);
  await client.query("SELECT set_config('app.bypass_rls', 'off', true)");
  if (found.rows.length === 0) {
    throw new Error(`Tenant "${tenantId}" does not exist in the tenants table.`);
  }
}

async function migrateTable(
  pool: import("pg").Pool,
  tableName: string,
  info?: TableInfo,
  tenantId?: string,
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
        const countRes = await client.query(`SELECT count(*)::int AS n FROM ${safe}`);
        const rowCount: number = countRes.rows[0].n;
        if (rowCount > 0 && !tenantId) {
          throw new Error(
            `${safe} has ${rowCount} existing row(s), and each row needs a tenant.\n` +
              `  Run again with --tenant <uuid> to assign every existing row to that tenant,\n` +
              `  or add and backfill tenant_id yourself (see "stratum scan --generate").`,
          );
        }

        log.info(`Adding tenant_id column to ${safe}...`);
        // The column starts nullable so that existing rows get a real tenant, not a placeholder.
        await client.query(`ALTER TABLE ${safe} ADD COLUMN tenant_id UUID`);
        if (rowCount > 0) {
          await assertTenantExists(client, tenantId as string);
          await client.query(`UPDATE ${safe} SET tenant_id = $1 WHERE tenant_id IS NULL`, [
            tenantId,
          ]);
          log.success(`Assigned ${rowCount} existing row(s) to tenant ${tenantId}`);
        }
        await client.query(`ALTER TABLE ${safe} ALTER COLUMN tenant_id SET NOT NULL`);
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
         USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)`,
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
           FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE NOT VALID`,
        );
        await client.query(`ALTER TABLE ${safe} VALIDATE CONSTRAINT ${fkName}`);
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

/** Lists tables whose existing policies do not filter by tenant. */
function logPolicyIssues(tables: TableInfo[]): void {
  const withIssue = tables.filter((t) => t.policy_issue);
  if (withIssue.length === 0) return;
  console.log();
  log.warn(
    `${withIssue.length} table(s) have policies that do not isolate tenants. ` +
      "Correct or drop those policies by hand; stratum migrate does not replace them:",
  );
  withIssue.forEach((t) => log.dim(`  ${t.table_name} — ${t.policy_issue}`));
}

export async function migrate(
  args: string[],
  flags: Record<string, string | boolean>,
): Promise<void> {
  const tenantId = parseTenantFlag(flags);
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
          t.has_policy ? "yes" : t.policy_issue ? "no filter" : "—",
          ready ? "\x1b[32mready\x1b[0m" : "\x1b[33mneeds migration\x1b[0m",
        ];
      });
      log.table([header, ...rows]);
      logPolicyIssues(tables);

      const unmigrated = tables.filter(
        (t) => !t.has_tenant_id || !t.rls_enabled || !t.rls_forced || !t.has_policy,
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
        (t) => !t.has_tenant_id || !t.rls_enabled || !t.rls_forced || !t.has_policy,
      );

      if (unmigrated.length === 0) {
        log.success("All tables are already migrated!");
        return;
      }

      // Adding a policy cannot fix these: PostgreSQL ORs permissive policies.
      logPolicyIssues(unmigrated);
      const migratable = unmigrated.filter((t) => !t.policy_issue);
      const leftWithIssue = unmigrated.length - migratable.length;
      // Exit non-zero while any table keeps a policy that does not filter by tenant.
      const failIfLeft = (): void => {
        if (leftWithIssue > 0) {
          throw new Error(
            `${leftWithIssue} table(s) still have policies that do not isolate tenants. ` +
              "Correct or drop them by hand, then run again.",
          );
        }
      };
      if (migratable.length === 0) {
        failIfLeft();
        return;
      }

      log.info(`Found ${migratable.length} table(s) to migrate:`);
      migratable.forEach((t) => log.dim(`  ${t.table_name}`));
      console.log();

      const proceed = await confirm("Proceed with migration?");
      if (!proceed) {
        log.info("Cancelled.");
        failIfLeft();
        return;
      }

      for (const table of migratable) {
        console.log();
        log.heading(`Migrating: ${table.table_name}`);
        await migrateTable(pool, table.table_name, table, tenantId);
      }

      console.log();
      log.success(`Migrated ${migratable.length} table(s).`);
      failIfLeft();
    } else if (args.length > 0) {
      // Migrate specific table
      const tableName = args[0];
      // Stratum's migrations own these tables and their RLS policies.
      if (STRATUM_TABLES.includes(tableName)) {
        throw new Error(
          `"${tableName}" is a Stratum table. "stratum migrate" only migrates application tables.`,
        );
      }
      log.heading(`Migrate: ${tableName}`);

      const tables = await scanTables(pool);
      const info = tables.find((t) => t.table_name === tableName);

      if (info && info.has_tenant_id && info.rls_enabled && info.rls_forced && info.has_policy) {
        log.success(`${tableName} is already fully migrated.`);
        return;
      }
      if (info?.policy_issue) {
        throw new Error(
          `${tableName}: ${info.policy_issue}. Correct or drop that policy by hand, then run again.`,
        );
      }

      const proceed = await confirm(
        `Add tenant_id + RLS + isolation policy to "${tableName}"?`,
      );
      if (!proceed) {
        log.info("Cancelled.");
        return;
      }

      await migrateTable(pool, tableName, info, tenantId);
    } else {
      console.error("Usage: stratum migrate <table> | --scan | --all [--tenant <uuid>]");
      process.exit(1);
    }

    console.log();
  } finally {
    await pool.end();
  }
}
