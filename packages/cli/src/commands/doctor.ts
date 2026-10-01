import pg from "pg";
import { connectDb, withRlsBypass } from "../utils/db.js";
import { evaluatePolicies, type PolicyRow } from "../utils/policy-check.js";

// ── ANSI Colors ──────────────────────────────────────────────────────
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const WHITE = "\x1b[37m";

// ── Result types ─────────────────────────────────────────────────────
type CheckStatus = "pass" | "fail" | "warn";

interface CheckResult {
  status: CheckStatus;
  label: string;
  summary: string;
  details?: string[];
}

// ── Output helpers ───────────────────────────────────────────────────
const STATUS_ICON: Record<CheckStatus, string> = {
  pass: `${GREEN}✓${RESET}`,
  fail: `${RED}✗${RESET}`,
  warn: `${YELLOW}⚠${RESET}`,
};

function printResult(result: CheckResult): void {
  const icon = STATUS_ICON[result.status];
  const labelColor =
    result.status === "fail" ? RED : result.status === "warn" ? YELLOW : WHITE;
  const label = result.label.padEnd(30);
  console.log(`  ${icon} ${labelColor}${label}${RESET} ${DIM}${result.summary}${RESET}`);
  if (result.details && result.details.length > 0) {
    for (const detail of result.details) {
      console.log(`    ${DIM}→ ${detail}${RESET}`);
    }
  }
}

// ── Stratum core tables ──────────────────────────────────────────────
const STRATUM_TABLES = [
  "tenants",
  "config_entries",
  "permission_policies",
  "api_keys",
  "webhooks",
  "webhook_events",
  "audit_logs",
];

// Stratum accepts a tenant tree of any depth. Config resolution reads every
// ancestor, so a deep tree makes it slower: doctor warns above this depth as a
// performance hint, and never fails on depth.
const DEFAULT_DEPTH_WARNING = 20;

const CYCLE_REPAIR_DOCS =
  "https://docs.stratum-hq.org/packages/cli/#repair-a-tenant-parent-cycle";

// ── Individual checks ────────────────────────────────────────────────

async function checkConnectivity(
  pool: pg.Pool,
): Promise<CheckResult> {
  const res = await pool.query("SHOW server_version;");
  const version = res.rows[0].server_version;
  return {
    status: "pass",
    label: "Database connectivity",
    summary: `OK (PostgreSQL ${version})`,
  };
}

async function checkSchema(pool: pg.Pool): Promise<CheckResult> {
  const res = await pool.query(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename = ANY($1);
  `, [STRATUM_TABLES]);

  const found = res.rows.map((r: { tablename: string }) => r.tablename);
  const missing = STRATUM_TABLES.filter((t) => !found.includes(t));

  if (missing.length === 0) {
    return {
      status: "pass",
      label: "Schema tables",
      summary: `${STRATUM_TABLES.length}/${STRATUM_TABLES.length} tables found`,
    };
  }

  if (found.length === 0) {
    return {
      status: "fail",
      label: "Schema tables",
      summary: "No Stratum tables found; run migrations first",
    };
  }

  return {
    status: "fail",
    label: "Schema tables",
    summary: `${found.length}/${STRATUM_TABLES.length} tables found`,
    details: missing.map((t) => `${t}: missing`),
  };
}

async function checkRLSEnabled(pool: pg.Pool): Promise<CheckResult> {
  // Check tenant-scoped tables (those with a tenant_id column) for RLS
  const res = await pool.query(`
    SELECT
      c.table_name,
      COALESCE(pc.relrowsecurity, false) AS rls_enabled,
      COALESCE(pc.relforcerowsecurity, false) AS rls_forced
    FROM information_schema.columns c
    JOIN pg_class pc ON pc.relname = c.table_name
      AND pc.relnamespace = 'public'::regnamespace
    WHERE c.table_schema = 'public'
      AND c.column_name = 'tenant_id'
      AND c.table_name NOT LIKE 'pg_%'
    ORDER BY c.table_name;
  `);

  const tables = res.rows as Array<{
    table_name: string;
    rls_enabled: boolean;
    rls_forced: boolean;
  }>;

  if (tables.length === 0) {
    return {
      status: "warn",
      label: "RLS enabled",
      summary: "No tenant-scoped tables found",
    };
  }

  const notEnabled = tables.filter((t) => !t.rls_enabled);
  const notForced = tables.filter((t) => t.rls_enabled && !t.rls_forced);
  const problems = [...notEnabled, ...notForced];

  if (problems.length === 0) {
    return {
      status: "pass",
      label: "RLS enabled",
      summary: `All ${tables.length} tenant-scoped tables have RLS enabled and forced`,
    };
  }

  const details: string[] = [];
  for (const t of notEnabled) {
    details.push(`${t.table_name}: RLS not enabled`);
  }
  for (const t of notForced) {
    details.push(`${t.table_name}: RLS enabled but not forced`);
  }

  return {
    status: "fail",
    label: "RLS enabled",
    summary: `${problems.length} table(s) missing RLS`,
    details,
  };
}

async function checkRLSPolicies(pool: pg.Pool): Promise<CheckResult> {
  // Check that the policies on every tenant-scoped table filter by tenant.
  // A policy's name proves nothing, so its expressions are checked.
  const res = await pool.query(`
    SELECT
      c.table_name,
      COALESCE((
        SELECT json_agg(json_build_object(
          'policyname', p.policyname,
          'permissive', p.permissive,
          'cmd', p.cmd,
          'qual', p.qual,
          'with_check', p.with_check
        ))
        FROM pg_policies p
        WHERE p.tablename = c.table_name
          AND p.schemaname = 'public'
      ), '[]'::json) AS policies
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name = 'tenant_id'
      AND c.table_name NOT LIKE 'pg_%'
    ORDER BY c.table_name;
  `);

  const tables = (res.rows as Array<{ table_name: string; policies: PolicyRow[] }>).map((t) => ({
    table_name: t.table_name,
    verdict: evaluatePolicies(t.policies, "public"),
  }));

  if (tables.length === 0) {
    return {
      status: "warn",
      label: "RLS policies",
      summary: "No tenant-scoped tables found",
    };
  }

  const missing = tables.filter((t) => !t.verdict.isolated);

  if (missing.length === 0) {
    return {
      status: "pass",
      label: "RLS policies",
      summary: "All tables have policies that filter by tenant",
    };
  }

  return {
    status: "fail",
    label: "RLS policies",
    summary: `${missing.length} table(s) without a policy that filters by tenant`,
    details: missing.map(
      (t) => `${t.table_name}: ${t.verdict.issue ?? "no tenant_isolation policy"}`,
    ),
  };
}

async function checkMissingIndexes(pool: pg.Pool): Promise<CheckResult> {
  const res = await pool.query(`
    SELECT
      c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_name = 'tenant_id'
      AND c.table_name NOT LIKE 'pg_%'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_indexes i
        WHERE i.schemaname = 'public'
          AND i.tablename = c.table_name
          AND i.indexdef LIKE '%tenant_id%'
      )
    ORDER BY c.table_name;
  `);

  const tables = res.rows as Array<{ table_name: string }>;

  if (tables.length === 0) {
    return {
      status: "pass",
      label: "Missing indexes",
      summary: "All tenant_id columns are indexed",
    };
  }

  return {
    status: "warn",
    label: "Missing indexes",
    summary: `${tables.length} table(s) missing index on tenant_id`,
    details: tables.map((t) => `${t.table_name}: no index on tenant_id`),
  };
}

async function checkOrphanedTenants(pool: pg.PoolClient): Promise<CheckResult> {
  const res = await pool.query(`
    SELECT t.id, t.name, t.parent_id
    FROM tenants t
    WHERE t.parent_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM tenants p
        WHERE p.id = t.parent_id
          AND p.status = 'active'
      );
  `);

  const orphans = res.rows as Array<{ id: string; name: string; parent_id: string }>;

  if (orphans.length === 0) {
    return {
      status: "pass",
      label: "Orphaned tenants",
      summary: "None found",
    };
  }

  return {
    status: "warn",
    label: "Orphaned tenants",
    summary: `${orphans.length} tenant(s) with missing or archived parent`,
    details: orphans.slice(0, 10).map(
      (o) => `${o.name} (${o.id.slice(0, 8)}...) → parent ${o.parent_id.slice(0, 8)}...`,
    ),
  };
}

async function checkParentCycles(pool: pg.PoolClient): Promise<CheckResult> {
  // Walk up from each tenant and keep the ids already seen, so the walk ends
  // on a loop. A tenant is on a cycle when its walk comes back to it. Each
  // cycle is reported once: from the member with the lowest id.
  const res = await pool.query(`
    WITH RECURSIVE up(start_id, id, parent_id, seen) AS (
      SELECT t.id, t.id, t.parent_id, ARRAY[t.id]
      FROM tenants t
      WHERE t.parent_id IS NOT NULL
      UNION ALL
      SELECT up.start_id, p.id, p.parent_id, up.seen || p.id
      FROM up
      JOIN tenants p ON p.id = up.parent_id
      WHERE p.id <> ALL (up.seen)
    )
    SELECT (
      SELECT json_agg(json_build_object('id', t.id, 'name', t.name) ORDER BY m.ord)
      FROM unnest(up.seen) WITH ORDINALITY AS m(id, ord)
      JOIN tenants t ON t.id = m.id
    ) AS members
    FROM up
    WHERE up.parent_id = up.start_id
      AND up.start_id <= ALL (up.seen)
    ORDER BY up.start_id;
  `);

  const cycles = res.rows as Array<{ members: Array<{ id: string; name: string }> }>;

  if (cycles.length === 0) {
    return {
      status: "pass",
      label: "Tenant parent cycles",
      summary: "None found",
    };
  }

  const details = cycles.slice(0, 10).map(({ members }) => {
    const names = members.map((m) => `${m.name} (${m.id.slice(0, 8)}...)`);
    return `Cycle: ${[...names, names[0]].join(" → ")}`;
  });
  // moveTenant is not a safe fix: it derives new paths from the stored
  // ancestry_path of the moved tenant, which a cycle can make wrong.
  details.push(
    "Fix: set parent_id of one tenant in each cycle to a tenant outside the cycle, or to NULL",
    `Then, in the same transaction, recompute ancestry_path and depth: ${CYCLE_REPAIR_DOCS}`,
  );

  return {
    status: "fail",
    label: "Tenant parent cycles",
    summary: `${cycles.length} cycle(s) in the tenant parent chain`,
    details,
  };
}

async function checkStaleApiKeys(pool: pg.PoolClient): Promise<CheckResult> {
  const res = await pool.query(`
    SELECT id, name, key_prefix, last_used_at
    FROM api_keys
    WHERE revoked_at IS NULL
      AND last_used_at IS NOT NULL
      AND last_used_at < NOW() - INTERVAL '90 days';
  `);

  const stale = res.rows as Array<{
    id: string;
    name: string | null;
    key_prefix: string | null;
    last_used_at: Date;
  }>;

  if (stale.length === 0) {
    return {
      status: "pass",
      label: "Stale API keys",
      summary: "No keys unused for 90+ days",
    };
  }

  return {
    status: "warn",
    label: "Stale API keys",
    summary: `${stale.length} key(s) unused for 90+ days`,
    details: stale.slice(0, 10).map((k) => {
      const label = k.name || k.key_prefix || k.id.slice(0, 8);
      const days = Math.floor(
        (Date.now() - new Date(k.last_used_at).getTime()) / (1000 * 60 * 60 * 24),
      );
      return `${label}: last used ${days} days ago`;
    }),
  };
}

async function checkExpiredApiKeys(pool: pg.PoolClient): Promise<CheckResult> {
  const res = await pool.query(`
    SELECT id, name, key_prefix, expires_at
    FROM api_keys
    WHERE revoked_at IS NULL
      AND expires_at IS NOT NULL
      AND expires_at < NOW();
  `);

  const expired = res.rows as Array<{
    id: string;
    name: string | null;
    key_prefix: string | null;
    expires_at: Date;
  }>;

  if (expired.length === 0) {
    return {
      status: "pass",
      label: "Expired API keys",
      summary: "No expired unrevoked keys",
    };
  }

  return {
    status: "warn",
    label: "Expired API keys",
    summary: `${expired.length} expired key(s) not yet revoked`,
    details: expired.slice(0, 10).map((k) => {
      const label = k.name || k.key_prefix || k.id.slice(0, 8);
      return `${label}: expired ${new Date(k.expires_at).toISOString().slice(0, 10)}`;
    }),
  };
}

function checkEncryptionKey(): CheckResult {
  const key = process.env.STRATUM_ENCRYPTION_KEY;
  if (key && key.length > 0) {
    return {
      status: "pass",
      label: "Encryption key",
      summary: "Configured",
    };
  }
  return {
    status: "warn",
    label: "Encryption key",
    summary: "STRATUM_ENCRYPTION_KEY env var not set",
    details: ["Sensitive config values will not be encrypted at rest"],
  };
}

interface DepthWarning {
  threshold: number;
  issue?: string;
}

/**
 * Returns the depth above which doctor warns, from the --depth-warning flag,
 * then STRATUM_DOCTOR_DEPTH_WARNING, then the default.
 * An invalid value gives the default and an issue to report.
 */
function resolveDepthWarning(flags: Record<string, string | boolean>): DepthWarning {
  const fromFlag = flags["depth-warning"] !== undefined;
  const raw = fromFlag ? flags["depth-warning"] : process.env.STRATUM_DOCTOR_DEPTH_WARNING;
  if (raw === undefined || raw === "") {
    return { threshold: DEFAULT_DEPTH_WARNING };
  }
  if (typeof raw === "string" && /^[1-9]\d*$/.test(raw)) {
    return { threshold: Number(raw) };
  }
  const source = fromFlag ? "--depth-warning" : "STRATUM_DOCTOR_DEPTH_WARNING";
  return {
    threshold: DEFAULT_DEPTH_WARNING,
    issue: `${source} must be a positive integer; using ${DEFAULT_DEPTH_WARNING}`,
  };
}

async function checkTreeDepth(
  pool: pg.PoolClient,
  { threshold, issue }: DepthWarning,
): Promise<CheckResult> {
  const res = await pool.query(`
    SELECT COALESCE(MAX(depth), 0) AS max_depth
    FROM tenants
    WHERE status = 'active';
  `);

  const maxDepth = parseInt(res.rows[0].max_depth, 10);
  const summary = `Max depth: ${maxDepth} (warning threshold: ${threshold})`;
  const details: string[] = issue ? [issue] : [];

  if (maxDepth > threshold) {
    const overRes = await pool.query(
      `SELECT id, name, depth FROM tenants WHERE depth > $1 AND status = 'active' ORDER BY depth DESC LIMIT 5;`,
      [threshold],
    );
    const over = overRes.rows as Array<{ id: string; name: string; depth: number }>;
    details.push(
      ...over.map((t) => `${t.name} (${t.id.slice(0, 8)}...): depth ${t.depth}`),
      "Advisory: Stratum accepts this depth, but config resolution reads every ancestor",
    );
    return { status: "warn", label: "Tree depth", summary, details };
  }

  if (issue) {
    return { status: "warn", label: "Tree depth", summary, details };
  }

  return { status: "pass", label: "Tree depth", summary };
}

// ── Main doctor command ──────────────────────────────────────────────

export async function doctor(flags: Record<string, string | boolean>): Promise<void> {
  const separator = `${DIM}${"═".repeat(42)}${RESET}`;

  console.log();
  console.log(`  ${BOLD}${CYAN}Stratum Doctor${RESET}`);
  console.log(`  ${separator}`);
  console.log();

  // 1. Attempt database connection
  let pool: pg.Pool;
  try {
    pool = await connectDb(flags);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    printResult({
      status: "fail",
      label: "Database connectivity",
      summary: `Connection failed: ${msg}`,
    });
    console.log();
    console.log(`  ${separator}`);
    console.log(`  ${RED}${BOLD}0 passed, 1 failed, 0 warnings${RESET}`);
    console.log();
    process.exit(1);
  }

  const results: CheckResult[] = [];

  try {
    // a. Database connectivity
    results.push(await checkConnectivity(pool));

    // b. Schema exists
    const schemaResult = await checkSchema(pool);
    results.push(schemaResult);

    // Only run table-dependent checks if we have at least the core tables
    const hasCoreSchema =
      schemaResult.status === "pass" ||
      (schemaResult.status === "fail" && !schemaResult.summary.includes("No Stratum tables"));

    if (hasCoreSchema) {
      // c. RLS enabled
      results.push(await checkRLSEnabled(pool));

      // d. RLS policies
      results.push(await checkRLSPolicies(pool));

      // e. Missing indexes
      results.push(await checkMissingIndexes(pool));

      // f. Orphaned tenants. The data checks below read Stratum tables that
      // have FORCE RLS, so each runs under the administrative bypass; without
      // it they see zero rows and report a pass they never checked.
      try {
        results.push(await withRlsBypass(pool, (client) => checkOrphanedTenants(client)));
      } catch {
        results.push({
          status: "warn",
          label: "Orphaned tenants",
          summary: "Could not query tenants table",
        });
      }

      // Tenant parent cycles
      try {
        results.push(await withRlsBypass(pool, (client) => checkParentCycles(client)));
      } catch {
        results.push({
          status: "warn",
          label: "Tenant parent cycles",
          summary: "Could not query tenants table",
        });
      }

      // g. Stale API keys
      try {
        results.push(await withRlsBypass(pool, (client) => checkStaleApiKeys(client)));
      } catch {
        results.push({
          status: "warn",
          label: "Stale API keys",
          summary: "Could not query api_keys table",
        });
      }

      // h. Expired API keys
      try {
        results.push(await withRlsBypass(pool, (client) => checkExpiredApiKeys(client)));
      } catch {
        results.push({
          status: "warn",
          label: "Expired API keys",
          summary: "Could not query api_keys table (expires_at column may not exist)",
        });
      }
    }

    // i. Encryption key (no DB required)
    results.push(checkEncryptionKey());

    // j. Tree depth
    if (hasCoreSchema) {
      try {
        const depthWarning = resolveDepthWarning(flags);
        results.push(
          await withRlsBypass(pool, (client) => checkTreeDepth(client, depthWarning)),
        );
      } catch {
        results.push({
          status: "warn",
          label: "Tree depth",
          summary: "Could not query tenant tree depth",
        });
      }
    }
  } finally {
    await pool.end();
  }

  // Print all results
  for (const result of results) {
    printResult(result);
  }

  // Summary
  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const warnings = results.filter((r) => r.status === "warn").length;

  console.log();
  console.log(`  ${separator}`);

  const parts: string[] = [];
  parts.push(`${GREEN}${passed} passed${RESET}`);
  if (failed > 0) {
    parts.push(`${RED}${failed} failed${RESET}`);
  } else {
    parts.push(`${DIM}0 failed${RESET}`);
  }
  if (warnings > 0) {
    parts.push(`${YELLOW}${warnings} warning${warnings !== 1 ? "s" : ""}${RESET}`);
  } else {
    parts.push(`${DIM}0 warnings${RESET}`);
  }

  console.log(`  ${parts.join(", ")}`);
  console.log();

  if (failed > 0) {
    process.exit(1);
  }
}
