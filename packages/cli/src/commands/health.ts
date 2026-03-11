import { connectDb, checkExtensions, checkBypassRLS, checkStratumTables, scanTables } from "../utils/db.js";
import * as log from "../utils/log.js";

export async function health(flags: Record<string, string | boolean>): Promise<void> {
  log.heading("Stratum Health Check");

  // 1. Database connection
  let pool;
  try {
    pool = await connectDb(flags);
    log.success("Database connection OK");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.fail(`Database connection failed: ${msg}`);
    log.info('Set DATABASE_URL or use --database-url <url>');
    process.exit(1);
  }

  try {
    // 2. PostgreSQL version
    const versionResult = await pool.query("SHOW server_version;");
    const version = versionResult.rows[0].server_version;
    const major = parseInt(version.split(".")[0], 10);
    if (major >= 16) {
      log.success(`PostgreSQL ${version}`);
    } else if (major >= 14) {
      log.warn(`PostgreSQL ${version} (16+ recommended)`);
    } else {
      log.fail(`PostgreSQL ${version} (14+ required)`);
    }

    // 3. Extensions
    const extensions = await checkExtensions(pool);
    if (extensions.uuid_ossp) {
      log.success("Extension: uuid-ossp");
    } else {
      log.fail("Extension: uuid-ossp (missing — run: CREATE EXTENSION \"uuid-ossp\")");
    }
    if (extensions.ltree) {
      log.success("Extension: ltree");
    } else {
      log.fail("Extension: ltree (missing — run: CREATE EXTENSION ltree)");
    }

    // 4. BYPASSRLS check
    const hasBypass = await checkBypassRLS(pool);
    if (hasBypass) {
      log.fail("Current role has BYPASSRLS — this bypasses all RLS policies!");
      log.info("Fix: ALTER ROLE <your_role> NOBYPASSRLS;");
    } else {
      log.success("Current role does NOT have BYPASSRLS");
    }

    // 5. Stratum tables
    const hasStratumTables = await checkStratumTables(pool);
    if (hasStratumTables) {
      log.success("Stratum schema tables found (tenants, config_entries, permission_policies, api_keys)");
    } else {
      log.warn("Stratum schema not found — run the control plane to auto-migrate, or apply 001_init.sql manually");
    }

    // 6. User tables RLS scan
    const tables = await scanTables(pool);
    if (tables.length > 0) {
      log.heading("Table RLS Status");
      const header = ["Table", "tenant_id", "RLS", "FORCE", "Policy"];
      const rows = tables.map((t) => [
        t.table_name,
        t.has_tenant_id ? "yes" : "—",
        t.rls_enabled ? "yes" : "—",
        t.rls_forced ? "yes" : "—",
        t.has_policy ? "yes" : "—",
      ]);
      log.table([header, ...rows]);

      const unmigrated = tables.filter((t) => !t.has_tenant_id || !t.rls_enabled || !t.has_policy);
      if (unmigrated.length > 0) {
        console.log();
        log.info(`${unmigrated.length} table(s) need migration. Run: stratum migrate <table>`);
      }
    } else {
      log.info("No user tables found in public schema");
    }

    console.log();
  } finally {
    await pool.end();
  }
}
