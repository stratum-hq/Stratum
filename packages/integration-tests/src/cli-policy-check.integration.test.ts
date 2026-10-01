import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

/**
 * Runs the built `stratum` CLI (packages/cli/dist) against a real PostgreSQL
 * database and checks that scan / migrate / health count a table as isolated
 * only when its row-level security policies actually filter rows by the
 * current tenant, whatever the policies are named.
 *
 * Each describe block rebuilds the public schema of a scratch database, so
 * the only user tables the CLI sees are the ones created here. The scratch
 * database is dropped afterwards.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, "../../cli/dist/index.js");

const BASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://stratum_test:stratum_test@localhost:5433/stratum_test";

const scratchDbName = `${new URL(BASE_URL).pathname.slice(1)}_cli_policy`;
const scratchUrl = (() => {
  const u = new URL(BASE_URL);
  u.pathname = `/${scratchDbName}`;
  return u.toString();
})();

function runCli(args: string[]): { code: number | null; out: string } {
  const res = spawnSync(process.execPath, [CLI, ...args, "--database-url", scratchUrl], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    input: "n\n",
    timeout: 30000,
  });
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

/** Recreates the public schema with one table that has tenant_id and forced RLS. */
async function resetWithOrders(policies: string): Promise<void> {
  await scratch.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  await scratch.query(`
    CREATE TABLE tenants (id UUID PRIMARY KEY);
    CREATE TABLE cli_orders (id UUID PRIMARY KEY, tenant_id UUID NOT NULL);
    ALTER TABLE cli_orders ENABLE ROW LEVEL SECURITY;
    ALTER TABLE cli_orders FORCE ROW LEVEL SECURITY;
  `);
  await scratch.query(policies);
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

/** Asserts that every command reports cli_orders as not isolated. */
function expectReportedNotIsolated(): void {
  it("scan does not report the table as isolated and says why", () => {
    const { out } = runCli(["scan"]);
    expect(out).not.toContain("All tables are properly isolated");
    expect(out).not.toMatch(/✓ cli_orders\b/);
    expect(out).toMatch(/cli_orders: .*does not filter by tenant/);
  });

  it("migrate --scan lists the table as needing work", () => {
    const { out } = runCli(["migrate", "--scan"]);
    expect(out).not.toContain("All tables are fully migrated!");
    expect(out).toMatch(/cli_orders.*needs migration/);
  });

  it("migrate --all does not report every table migrated", () => {
    const { out } = runCli(["migrate", "--all"]);
    expect(out).not.toContain("All tables are already migrated!");
    expect(out).toContain("cli_orders");
  });

  it("migrate --all exits non-zero while the table is left with that policy", () => {
    const { code } = runCli(["migrate", "--all"]);
    expect(code).not.toBe(0);
  });

  it("migrate <table> does not report the table as fully migrated", () => {
    const { out } = runCli(["migrate", "cli_orders"]);
    expect(out).not.toContain("already fully migrated");
  });

  it("health counts the table as needing migration", () => {
    const { out } = runCli(["health"]);
    expect(out).toContain("1 table(s) need migration");
  });

  it("doctor fails the RLS policy check for the table and says why", () => {
    const { out } = runCli(["doctor"]);
    expect(out).not.toMatch(/All tables have (a )?tenant_isolation policy/);
    expect(out).toMatch(/cli_orders: .*does not filter by tenant/);
  });
}

describe("CLI isolation checks: a tenant_isolation policy that admits every row", () => {
  beforeAll(async () => {
    await resetWithOrders(`CREATE POLICY tenant_isolation ON cli_orders USING (true);`);
  });
  expectReportedNotIsolated();
});

describe("CLI isolation checks: a tenant_isolation policy on some other condition", () => {
  beforeAll(async () => {
    await resetWithOrders(
      `CREATE POLICY tenant_isolation ON cli_orders USING (tenant_id IS NOT NULL);`,
    );
  });
  expectReportedNotIsolated();
});

describe("CLI isolation checks: a correct policy next to a permissive policy that admits every row", () => {
  beforeAll(async () => {
    await resetWithOrders(`
      CREATE POLICY tenant_isolation ON cli_orders
        USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
      CREATE POLICY allow_all ON cli_orders FOR SELECT USING (true);
    `);
  });
  expectReportedNotIsolated();
});

describe("CLI isolation checks: a policy that filters reads but lets writes name any tenant", () => {
  beforeAll(async () => {
    await resetWithOrders(`
      CREATE POLICY tenant_isolation ON cli_orders
        USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
        WITH CHECK (true);
    `);
  });
  expectReportedNotIsolated();
});

describe("CLI isolation checks: policies that do filter by the current tenant", () => {
  const isolatingPolicies: Array<[string, string]> = [
    [
      "the policy the CLI and db-adapters generate",
      `CREATE POLICY tenant_isolation ON cli_orders
         USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);`,
    ],
    [
      "the older policy without NULLIF",
      `CREATE POLICY tenant_isolation ON cli_orders
         USING (tenant_id = current_setting('app.current_tenant_id')::uuid);`,
    ],
    [
      "a policy with another name, the operands reversed and an extra condition",
      `CREATE POLICY orders_by_tenant ON cli_orders
         USING (NULLIF(current_setting('app.current_tenant_id', true), '')::uuid = tenant_id AND id IS NOT NULL);`,
    ],
    [
      "Stratum's own pattern with the administrative bypass",
      `CREATE POLICY tenant_isolation ON cli_orders
         USING (current_setting('app.bypass_rls', true) = 'on'
                OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);`,
    ],
  ];

  for (const [name, policy] of isolatingPolicies) {
    it(`scan reports the table as isolated with ${name}`, async () => {
      await resetWithOrders(policy);
      const { out } = runCli(["scan"]);
      expect(out).toContain("All tables are properly isolated");
      expect(out).toMatch(/✓ cli_orders\b/);
    });
  }

  it("migrate and health report the table as done with the generated policy", async () => {
    await resetWithOrders(isolatingPolicies[0][1]);
    expect(runCli(["migrate", "--scan"]).out).toContain("All tables are fully migrated!");
    expect(runCli(["migrate", "cli_orders"]).out).toContain("already fully migrated");
    expect(runCli(["health"]).out).not.toContain("need migration");
    expect(runCli(["doctor"]).out).not.toMatch(/cli_orders: .*(tenant_isolation|filter by tenant)/);
  });
});

describe("CLI isolation checks: SQL from scan --generate passes the check it came from", () => {
  it("reports a freshly generated table as isolated", async () => {
    await scratch.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
    await scratch.query(`
      CREATE TABLE tenants (id UUID PRIMARY KEY);
      CREATE TABLE cli_invoices (id UUID PRIMARY KEY);
    `);
    await scratch.query(generatedSql(runCli(["scan", "--generate"]).out));
    const { out } = runCli(["scan"]);
    expect(out).toContain("All tables are properly isolated");
  });

  it("does not emit a second CREATE POLICY for a table whose tenant_isolation policy is wrong", async () => {
    await resetWithOrders(`CREATE POLICY tenant_isolation ON cli_orders USING (true);`);
    const sql = generatedSql(runCli(["scan", "--generate"]).out);
    expect(sql).not.toContain(`CREATE POLICY tenant_isolation ON "cli_orders"`);
    // The script must still apply cleanly.
    await scratch.query(sql);
  });
});
