import { PINNED_SEARCH_PATH, STRATUM_TABLES } from "@stratum-hq/lib";
import {
  connectDb,
  connectAdminDb,
  controlRoleFlag,
  crossTenantRunner,
  quoteIdent,
  scanTables,
  type TableInfo,
} from "../utils/db.js";
import { confirm } from "../utils/prompt.js";
import * as log from "../utils/log.js";

// The SQL below uses table names unquoted, which PostgreSQL folds to lower
// case, so only lowercase names name the table they came from.
const TABLE_NAME = /^[a-z_][a-z0-9_]*$/;

function validateTableName(name: string): string {
  if (!TABLE_NAME.test(name)) {
    throw new Error(
      `Invalid table name: "${name}". Only lowercase letters, digits, and underscores allowed; ` +
        `"stratum scan --generate" writes SQL for other names.`,
    );
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

/** Whether a tenant id is a row of Stratum's tenants table. */
type TenantLookup = (tenantId: string) => Promise<boolean>;

/** Throws unless `tenantId` is a row in the tenants table, when that table exists. */
async function assertTenantExists(
  client: import("pg").PoolClient,
  tenantId: string,
  tenantExists: TenantLookup,
): Promise<void> {
  const hasTenants = await client.query(
    "SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'tenants'",
  );
  if (hasTenants.rows.length === 0) return;

  if (!(await tenantExists(tenantId))) {
    throw new Error(`Tenant "${tenantId}" does not exist in the tenants table.`);
  }
}

async function migrateTable(
  pool: import("pg").Pool,
  tableName: string,
  info: TableInfo | undefined,
  tenantId: string | undefined,
  tenantExists: TenantLookup,
): Promise<void> {
  const safe = validateTableName(tableName);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Find the table through the search path: public, or a schema of the
    // login's own (the hardening guide keeps the application's tables there).
    // This query names every function and operator with pg_catalog; the rest
    // of the transaction runs with only pg_catalog on the search path, and
    // names the table with its schema.
    const exists = await client.query<{ nsp: string }>(
      `SELECT n.nspname::pg_catalog.text AS nsp
         FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid OPERATOR(pg_catalog.=) c.relnamespace
        WHERE c.oid OPERATOR(pg_catalog.=) pg_catalog.to_regclass($1::pg_catalog.text)::pg_catalog.oid
          AND c.relkind OPERATOR(pg_catalog.=) ANY ('{r,p}'::pg_catalog."char"[])`,
      [safe],
    );
    if (exists.rows.length === 0) {
      throw new Error(`Table "${safe}" does not exist in a schema on the search path`);
    }
    const tableSchema = exists.rows[0].nsp;
    await client.query(`SET LOCAL search_path = ${PINNED_SEARCH_PATH}`);
    const table = `${quoteIdent(tableSchema)}.${safe}`;

    // Add tenant_id if missing
    if (!info || !info.has_tenant_id) {
      const hasCol = await client.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = $2 AND table_name = $1 AND column_name = 'tenant_id'`,
        [safe, tableSchema],
      );
      if (hasCol.rows.length === 0) {
        const countRes = await client.query(`SELECT count(*)::int AS n FROM ${table}`);
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
        await client.query(`ALTER TABLE ${table} ADD COLUMN tenant_id UUID`);
        if (rowCount > 0) {
          await assertTenantExists(client, tenantId as string, tenantExists);
          await client.query(`UPDATE ${table} SET tenant_id = $1 WHERE tenant_id IS NULL`, [
            tenantId,
          ]);
          log.success(`Assigned ${rowCount} existing row(s) to tenant ${tenantId}`);
        }
        await client.query(`ALTER TABLE ${table} ALTER COLUMN tenant_id SET NOT NULL`);
        log.success(`Added tenant_id column to ${safe}`);
      } else {
        log.info(`${safe} already has tenant_id column`);
      }
    }

    // Enable RLS
    if (!info || !info.rls_enabled) {
      log.info(`Enabling RLS on ${safe}...`);
      await client.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await client.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      log.success(`RLS enabled on ${safe}`);
    } else if (!info.rls_forced) {
      await client.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      log.success(`FORCE RLS enabled on ${safe}`);
    }

    // Create isolation policy
    if (!info || !info.has_policy) {
      log.info(`Creating tenant_isolation policy on ${safe}...`);
      await client.query(
        `CREATE POLICY tenant_isolation ON ${table}
         USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)`,
      );
      log.success(`tenant_isolation policy created on ${safe}`);
    }

    // Add index on tenant_id
    const idxName = `idx_${safe}_tenant_id`;
    const hasIdx = await client.query(
      "SELECT 1 FROM pg_indexes WHERE schemaname = $2 AND indexname = $1",
      [idxName, tableSchema],
    );
    if (hasIdx.rows.length === 0) {
      await client.query(`CREATE INDEX ${idxName} ON ${table}(tenant_id)`);
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
        // The role model of migration 032 grants the application login
        // SELECT on tenants, not REFERENCES, so a foreign key to it needs a
        // grant that the operator chooses to give.
        const canReference = await client.query(
          "SELECT has_column_privilege('public.tenants', 'id', 'REFERENCES') AS ok",
        );
        if (canReference.rows[0]?.ok !== true) {
          throw new Error(
            `This login cannot add a foreign key from ${safe}.tenant_id to tenants(id): it has no REFERENCES ` +
              "privilege on tenants. As an administrator, run: GRANT REFERENCES (id) ON tenants TO <this login>; " +
              "then run the migration again.",
          );
        }
        await client.query(
          `ALTER TABLE ${table} ADD CONSTRAINT ${fkName}
           FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE NOT VALID`,
        );
        await client.query(`ALTER TABLE ${table} VALIDATE CONSTRAINT ${fkName}`);
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
  withIssue.forEach((t) => log.dim(`  ${t.table_name}: ${t.policy_issue}`));
}

export async function migrate(
  args: string[],
  flags: Record<string, string | boolean>,
): Promise<void> {
  const tenantId = parseTenantFlag(flags);
  const controlRole = controlRoleFlag(flags);
  const pool = await connectDb(flags);
  let adminPool: import("pg").Pool | undefined;
  try {
    adminPool = await connectAdminDb(flags);
  } catch (err) {
    await pool.end();
    throw err;
  }
  // Stratum's tenants table has FORCE RLS, so the lookup runs as the control
  // role on the admin login, or under the legacy administrative bypass, on a
  // connection of its own: nothing of it reaches the migration's transaction.
  const tenantExists: TenantLookup = async (id) => {
    const run = await crossTenantRunner(pool, adminPool, controlRole);
    const found = await run((client, schema) => client.query(`SELECT 1 FROM ${schema}.tenants WHERE id = $1`, [id]));
    return found.rows.length > 0;
  };

  try {
    if (flags["scan"]) {
      // Scan mode
      log.heading("Database Table Scan");
      const tables = await scanTables(pool, controlRole);

      if (tables.length === 0) {
        log.info("No user tables found in the public schema.");
        return;
      }

      const header = ["Table", "tenant_id", "RLS", "FORCE", "Policy", "Status"];
      const rows = tables.map((t) => {
        const ready = t.has_tenant_id && t.rls_enabled && t.rls_forced && t.has_policy;
        return [
          t.table_name,
          t.has_tenant_id ? "yes" : "no",
          t.rls_enabled ? "yes" : "no",
          t.rls_forced ? "yes" : "no",
          t.has_policy ? "yes" : t.policy_issue ? "no filter" : "no",
          ready
            ? `${log.ansi("\x1b[32m")}ready${log.ansi("\x1b[0m")}`
            : `${log.ansi("\x1b[33m")}needs migration${log.ansi("\x1b[0m")}`,
        ];
      });
      log.table([header, ...rows]);
      logPolicyIssues(tables);

      const unmigrated = tables.filter(
        (t) => !t.has_tenant_id || !t.rls_enabled || !t.rls_forced || !t.has_policy,
      );
      if (unmigrated.length > 0) {
        // Suggest the command only where it runs: not for a table whose
        // policy needs fixing by hand, nor for a name it does not take.
        const migratable = unmigrated.filter((t) => !t.policy_issue && TABLE_NAME.test(t.table_name));
        const otherNames = unmigrated.filter((t) => !t.policy_issue && !TABLE_NAME.test(t.table_name));
        console.log();
        log.info(`${unmigrated.length} table(s) need migration:`);
        migratable.forEach((t) => log.dim(`  stratum migrate ${t.table_name}`));
        if (otherNames.length > 0) {
          log.info(
            `${otherNames.length} table(s) have names that stratum migrate does not take; ` +
              "stratum scan --generate writes SQL for them:",
          );
          otherNames.forEach((t) => log.dim(`  ${t.table_name}`));
        }
      } else {
        console.log();
        log.success("All tables are fully migrated!");
      }
    } else if (flags["all"]) {
      // Migrate all unmigrated tables
      log.heading("Migrate All Tables");
      const tables = await scanTables(pool, controlRole);
      const unmigrated = tables.filter(
        (t) => !t.has_tenant_id || !t.rls_enabled || !t.rls_forced || !t.has_policy,
      );

      if (unmigrated.length === 0) {
        log.success("All tables are already migrated!");
        return;
      }

      // Adding a policy cannot fix these: PostgreSQL ORs permissive policies.
      logPolicyIssues(unmigrated);
      const otherNames = unmigrated.filter((t) => !t.policy_issue && !TABLE_NAME.test(t.table_name));
      if (otherNames.length > 0) {
        log.warn(
          `Skipping ${otherNames.length} table(s) whose names stratum migrate does not take; ` +
            "stratum scan --generate writes SQL for them:",
        );
        otherNames.forEach((t) => log.dim(`  ${t.table_name}`));
      }
      const migratable = unmigrated.filter((t) => !t.policy_issue && TABLE_NAME.test(t.table_name));
      const leftWithIssue = unmigrated.filter((t) => t.policy_issue).length;
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
        await migrateTable(pool, table.table_name, table, tenantId, tenantExists);
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

      const tables = await scanTables(pool, controlRole);
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

      await migrateTable(pool, tableName, info, tenantId, tenantExists);
    } else {
      console.error("Usage: stratum migrate <table> | --scan | --all [--tenant <uuid>]");
      process.exit(1);
    }

    console.log();
  } finally {
    await pool.end();
    await adminPool?.end();
  }
}
