import type pg from "pg";
import { inspectRoleModel } from "@stratum-hq/lib";
import {
  connectDb,
  connectAdminDb,
  controlRoleFlag,
  checkExtensions,
  checkBypassRLS,
  checkStratumTables,
  scanTables,
} from "../utils/db.js";
import { roleModelChecks } from "../utils/role-model.js";
import * as log from "../utils/log.js";

export async function health(flags: Record<string, string | boolean>): Promise<void> {
  log.heading("Stratum Health Check");
  const controlRole = controlRoleFlag(flags);

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

  let adminPool: pg.Pool | undefined;
  try {
    adminPool = await connectAdminDb(flags);
    if (adminPool) log.success("Admin database connection OK");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.fail(msg);
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
      log.fail("Extension: uuid-ossp (missing; run: CREATE EXTENSION \"uuid-ossp\")");
    }
    if (extensions.ltree) {
      log.success("Extension: ltree");
    } else {
      log.fail("Extension: ltree (missing; run: CREATE EXTENSION ltree)");
    }

    // 4. BYPASSRLS check
    const hasBypass = await checkBypassRLS(pool);
    if (hasBypass) {
      log.fail("Current role has BYPASSRLS; this bypasses all RLS policies!");
      log.info("Fix: ALTER ROLE <your_role> NOBYPASSRLS;");
    } else {
      log.success("Current role does NOT have BYPASSRLS");
    }

    // 5. Stratum tables
    const hasStratumTables = await checkStratumTables(pool);
    if (hasStratumTables) {
      log.success("Stratum schema tables found (tenants, config_entries, permission_policies, api_keys)");

      // 5b. Role model of migration 032 (opt-in hardening in 1.x)
      log.heading("Role Model");
      try {
        const report = await inspectRoleModel({ appPool: pool, adminPool, controlRole });
        for (const check of roleModelChecks(report)) {
          const line = `${check.label}: ${check.summary}`;
          if (check.status === "pass") log.success(line);
          else if (check.status === "warn") log.warn(line);
          else log.fail(line);
          check.details?.forEach((d) => log.dim(`  ${d}`));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(`Could not check the role model: ${msg}`);
      }
    } else {
      log.warn("Stratum schema not found. Run the control plane to auto-migrate, or apply 001_init.sql manually");
    }

    // 6. User tables RLS scan
    const tables = await scanTables(pool, controlRole);
    if (tables.length > 0) {
      log.heading("Table RLS Status");
      const header = ["Table", "tenant_id", "RLS", "FORCE", "Policy"];
      const rows = tables.map((t) => [
        t.table_name,
        t.has_tenant_id ? "yes" : "no",
        t.rls_enabled ? "yes" : "no",
        t.rls_forced ? "yes" : "no",
        t.has_policy ? "yes" : t.policy_issue ? "no filter" : "no",
      ]);
      log.table([header, ...rows]);

      const withPolicyIssue = tables.filter((t) => t.policy_issue);
      if (withPolicyIssue.length > 0) {
        console.log();
        log.warn(`${withPolicyIssue.length} table(s) have policies that do not isolate tenants:`);
        withPolicyIssue.forEach((t) => log.dim(`  ${t.table_name}: ${t.policy_issue}`));
      }

      const unmigrated = tables.filter((t) => !t.has_tenant_id || !t.rls_enabled || !t.rls_forced || !t.has_policy);
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
    await adminPool?.end();
  }
}
