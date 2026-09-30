import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

/**
 * Runs the built `stratum` CLI (packages/cli/dist) against a real PostgreSQL
 * database and checks what it reports and generates.
 *
 * The scan / migrate / health checks run against a scratch database created
 * here, so the only user tables the CLI sees are the ones these tests create.
 * The scratch database is dropped afterwards.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, "../../cli/dist/index.js");

const BASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://stratum_test:stratum_test@localhost:5433/stratum_test";

const scratchDbName = `${new URL(BASE_URL).pathname.slice(1)}_cli_scan`;
const scratchUrl = (() => {
  const u = new URL(BASE_URL);
  u.pathname = `/${scratchDbName}`;
  return u.toString();
})();

function runCli(args: string[], databaseUrl: string): { code: number | null; out: string } {
  const res = spawnSync(process.execPath, [CLI, ...args, "--database-url", databaseUrl], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    input: "n\n",
    timeout: 30000,
  });
  // Strip ANSI colour codes so assertions read naturally.
  // eslint-disable-next-line no-control-regex
  const out = `${res.stdout}${res.stderr}`.replace(/\x1b\[[0-9;]*m/g, "");
  return { code: res.status, out };
}

/** The SQL block `scan --generate` prints after its report. */
function generatedSql(out: string): string {
  const start = out.indexOf("-- Stratum Migration Scanner");
  expect(start).toBeGreaterThanOrEqual(0);
  return out.slice(start);
}

let admin: pg.Client;
let scratch: pg.Client;

async function resetScratchTables(): Promise<void> {
  await scratch.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  await scratch.query(`CREATE TABLE tenants (id UUID PRIMARY KEY)`);
}

beforeAll(async () => {
  admin = new pg.Client({ connectionString: BASE_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${scratchDbName}"`);
  await admin.query(`CREATE DATABASE "${scratchDbName}"`);
  scratch = new pg.Client({ connectionString: scratchUrl });
  await scratch.connect();
});

afterAll(async () => {
  await scratch?.end();
  await admin?.query(`DROP DATABASE IF EXISTS "${scratchDbName}"`);
  await admin?.end();
});

describe("CLI RLS status: a table with RLS enabled but not forced", () => {
  beforeAll(async () => {
    await resetScratchTables();
    await scratch.query(`
      CREATE TABLE cli_orders (id UUID PRIMARY KEY, tenant_id UUID NOT NULL);
      ALTER TABLE cli_orders ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON cli_orders
        USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
    `);
  });

  it("scan reports the table as needing FORCE, not as isolated", () => {
    const { out } = runCli(["scan"], scratchUrl);
    expect(out).not.toContain("All tables are properly isolated");
    expect(out).not.toMatch(/✓ cli_orders\b/);
    expect(out).toMatch(/cli_orders — .*not forced/);
  });

  it("scan --generate emits FORCE ROW LEVEL SECURITY for the table", () => {
    const { out } = runCli(["scan", "--generate"], scratchUrl);
    expect(generatedSql(out)).toContain(`ALTER TABLE "cli_orders" FORCE ROW LEVEL SECURITY;`);
  });

  it("migrate --scan lists the table as needing migration", () => {
    const { out } = runCli(["migrate", "--scan"], scratchUrl);
    expect(out).not.toContain("All tables are fully migrated!");
    expect(out).toContain("stratum migrate cli_orders");
  });

  it("migrate --all includes the table instead of reporting everything migrated", () => {
    const { out } = runCli(["migrate", "--all"], scratchUrl);
    expect(out).not.toContain("All tables are already migrated!");
    expect(out).toContain("Found 1 table(s) to migrate");
  });

  it("health counts the table as needing migration", () => {
    const { out } = runCli(["health"], scratchUrl);
    expect(out).toContain("1 table(s) need migration");
  });
});

describe("CLI scan --generate: SQL that a DBA runs as written", () => {
  beforeAll(async () => {
    await resetScratchTables();
    await scratch.query(`
      CREATE TABLE "CliInvoices" (id UUID PRIMARY KEY);
      CREATE TABLE "cli ""line"" items; note" (id UUID PRIMARY KEY);
    `);
  });

  it("forces RLS on tables that get a new tenant_id column", () => {
    const { out } = runCli(["scan", "--generate"], scratchUrl);
    expect(generatedSql(out)).toContain(`ALTER TABLE "CliInvoices" FORCE ROW LEVEL SECURITY;`);
  });

  it("quotes table names so the generated SQL applies to exactly those tables", async () => {
    const { out } = runCli(["scan", "--generate"], scratchUrl);
    const sql = generatedSql(out);

    // Executing the generated script must succeed and affect only the scanned
    // tables, whatever characters their names contain.
    await scratch.query(sql);

    const res = await scratch.query(`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
        EXISTS (SELECT 1 FROM information_schema.columns col
                WHERE col.table_schema = 'public' AND col.table_name = c.relname
                  AND col.column_name = 'tenant_id') AS has_tenant_id,
        EXISTS (SELECT 1 FROM pg_policies p
                WHERE p.schemaname = 'public' AND p.tablename = c.relname
                  AND p.policyname = 'tenant_isolation') AS has_policy
      FROM pg_class c
      WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname <> 'tenants'
      ORDER BY c.relname
    `);
    expect(res.rows).toEqual([
      { relname: "CliInvoices", relrowsecurity: true, relforcerowsecurity: true, has_tenant_id: true, has_policy: true },
      { relname: `cli "line" items; note`, relrowsecurity: true, relforcerowsecurity: true, has_tenant_id: true, has_policy: true },
    ]);
  });
});
