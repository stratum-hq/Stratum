/**
 * stratum scan — Migration scanner.
 *
 * Scans an existing database, identifies tables that need tenant isolation,
 * and generates migration SQL to add tenant_id columns + RLS policies.
 *
 * Usage:
 *   stratum scan                           # scan and show report
 *   stratum scan --generate                # generate migration SQL
 *   stratum scan --database-url <url>      # custom database URL
 *   stratum scan --exclude users,sessions  # exclude specific tables
 */

import { connectDb, scanTables, type TableInfo } from "../utils/db.js";
import { log } from "../utils/log.js";

interface ScanResult {
  needsTenantId: TableInfo[];
  needsRLS: TableInfo[];
  needsPolicy: TableInfo[];
  alreadyIsolated: TableInfo[];
  skipped: string[];
}

function analyzeTables(tables: TableInfo[], exclude: string[]): ScanResult {
  const result: ScanResult = {
    needsTenantId: [],
    needsRLS: [],
    needsPolicy: [],
    alreadyIsolated: [],
    skipped: [],
  };

  for (const table of tables) {
    if (exclude.includes(table.table_name)) {
      result.skipped.push(table.table_name);
      continue;
    }

    if (!table.has_tenant_id) {
      result.needsTenantId.push(table);
    } else if (!table.rls_enabled) {
      result.needsRLS.push(table);
    } else if (!table.has_policy) {
      result.needsPolicy.push(table);
    } else {
      result.alreadyIsolated.push(table);
    }
  }

  return result;
}

function generateMigrationSQL(result: ScanResult): string {
  const lines: string[] = [
    "-- Stratum Migration Scanner — auto-generated",
    "-- Review carefully before running in production",
    "",
    "BEGIN;",
    "",
  ];

  // Step 1: Add tenant_id columns
  if (result.needsTenantId.length > 0) {
    lines.push("-- Step 1: Add tenant_id column to tables that need it");
    for (const table of result.needsTenantId) {
      lines.push(`ALTER TABLE ${table.table_name} ADD COLUMN tenant_id UUID REFERENCES tenants(id);`);
    }
    lines.push("");
  }

  // Step 2: Enable RLS
  const tablesNeedingRLS = [...result.needsTenantId, ...result.needsRLS];
  if (tablesNeedingRLS.length > 0) {
    lines.push("-- Step 2: Enable Row-Level Security");
    for (const table of tablesNeedingRLS) {
      lines.push(`ALTER TABLE ${table.table_name} ENABLE ROW LEVEL SECURITY;`);
    }
    lines.push("");
  }

  // Step 3: Create RLS policies
  const tablesNeedingPolicy = [...result.needsTenantId, ...result.needsRLS, ...result.needsPolicy];
  if (tablesNeedingPolicy.length > 0) {
    lines.push("-- Step 3: Create tenant isolation policies");
    for (const table of tablesNeedingPolicy) {
      lines.push(
        `CREATE POLICY tenant_isolation ON ${table.table_name}` +
        `  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);`,
      );
    }
    lines.push("");
  }

  // Step 4: Create indexes
  if (result.needsTenantId.length > 0) {
    lines.push("-- Step 4: Add indexes for tenant_id lookups");
    for (const table of result.needsTenantId) {
      lines.push(`CREATE INDEX idx_${table.table_name}_tenant ON ${table.table_name}(tenant_id);`);
    }
    lines.push("");
  }

  lines.push("COMMIT;");
  lines.push("");
  lines.push("-- WARNING: Tables with new tenant_id columns will have NULL values.");
  lines.push("-- You must backfill tenant_id for existing rows before enforcing NOT NULL:");
  lines.push("--   UPDATE <table> SET tenant_id = '<your-tenant-uuid>' WHERE tenant_id IS NULL;");
  lines.push("--   ALTER TABLE <table> ALTER COLUMN tenant_id SET NOT NULL;");

  return lines.join("\n");
}

export async function scan(
  _args: string[],
  flags: Record<string, string | boolean>,
): Promise<void> {
  const generate = flags.generate === true || flags.g === true;
  const excludeRaw = (flags.exclude as string) || "";
  const exclude = excludeRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  log.info("Scanning database for tables needing tenant isolation...\n");

  const pool = await connectDb(flags);

  try {
    const tables = await scanTables(pool);
    const result = analyzeTables(tables, exclude);

    const totalTables = tables.length - result.skipped.length;
    const isolated = result.alreadyIsolated.length;
    const actionNeeded =
      result.needsTenantId.length +
      result.needsRLS.length +
      result.needsPolicy.length;

    // Report
    log.info(`Found ${totalTables} tables in public schema.\n`);

    if (result.alreadyIsolated.length > 0) {
      log.success(`  ${isolated} already isolated:`);
      for (const t of result.alreadyIsolated) {
        log.dim(`    ✓ ${t.table_name}`);
      }
      console.log();
    }

    if (result.needsTenantId.length > 0) {
      log.warn(`  ${result.needsTenantId.length} need tenant_id column:`);
      for (const t of result.needsTenantId) {
        log.dim(`    ✗ ${t.table_name} — no tenant_id column`);
      }
      console.log();
    }

    if (result.needsRLS.length > 0) {
      log.warn(`  ${result.needsRLS.length} have tenant_id but no RLS:`);
      for (const t of result.needsRLS) {
        log.dim(`    ⚠ ${t.table_name} — has tenant_id, RLS not enabled`);
      }
      console.log();
    }

    if (result.needsPolicy.length > 0) {
      log.warn(`  ${result.needsPolicy.length} have RLS enabled but no policy:`);
      for (const t of result.needsPolicy) {
        log.dim(`    ⚠ ${t.table_name} — RLS enabled, no tenant_isolation policy`);
      }
      console.log();
    }

    if (result.skipped.length > 0) {
      log.dim(`  Skipped (excluded): ${result.skipped.join(", ")}`);
      console.log();
    }

    if (actionNeeded === 0) {
      log.success("All tables are properly isolated. Nothing to do.\n");
      return;
    }

    // Summary
    log.info(`  Summary: ${actionNeeded} table(s) need migration, ${isolated} already done.\n`);

    if (generate) {
      console.log("\n" + generateMigrationSQL(result));
    } else {
      log.info('  Run with --generate to output migration SQL.\n');
      log.dim('  Example: stratum scan --generate > migration.sql\n');
    }
  } finally {
    await pool.end();
  }
}
