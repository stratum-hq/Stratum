import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

/**
 * Runs the built `stratum migrate <table>` (packages/cli/dist) against a real
 * PostgreSQL database and checks the table it leaves behind.
 *
 * The tests use a scratch database that this file creates and drops. The
 * scratch `tenants` table has FORCE RLS with a bypass policy, the same as a
 * Stratum database, so the CLI must set the bypass to read it.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, "../../cli/dist/index.js");

const BASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://stratum_test:stratum_test@localhost:5433/stratum_test";

const scratchDbName = `${new URL(BASE_URL).pathname.slice(1)}_cli_migrate`;
const scratchUrl = (() => {
  const u = new URL(BASE_URL);
  u.pathname = `/${scratchDbName}`;
  return u.toString();
})();

const TENANT_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const UNKNOWN_TENANT_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

function runMigrate(args: string[]): { code: number | null; out: string } {
  const res = spawnSync(
    process.execPath,
    [CLI, "migrate", ...args, "--database-url", scratchUrl],
    {
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
      input: "y\n",
      timeout: 30000,
    },
  );
  // Strip ANSI colour codes so assertions read naturally.
  // eslint-disable-next-line no-control-regex
  const out = `${res.stdout}${res.stderr}`.replace(/\x1b\[[0-9;]*m/g, "");
  return { code: res.status, out };
}

let admin: pg.Client;
let scratch: pg.Client;

interface TableState {
  has_tenant_id: boolean;
  tenant_id_nullable: boolean | null;
  rls_forced: boolean;
  has_policy: boolean;
  fk_validated: boolean | null;
}

async function tableState(table: string): Promise<TableState> {
  const res = await scratch.query(
    `SELECT
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = $1
                 AND column_name = 'tenant_id') AS has_tenant_id,
       (SELECT is_nullable = 'YES' FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
          AND column_name = 'tenant_id') AS tenant_id_nullable,
       (SELECT relforcerowsecurity FROM pg_class
        WHERE relname = $1 AND relnamespace = 'public'::regnamespace) AS rls_forced,
       EXISTS (SELECT 1 FROM pg_policies
               WHERE schemaname = 'public' AND tablename = $1
                 AND policyname = 'tenant_isolation') AS has_policy,
       (SELECT convalidated FROM pg_constraint
        WHERE conname = 'fk_' || $1 || '_tenant_id') AS fk_validated`,
    [table],
  );
  return res.rows[0];
}

/** Reads the table as its owner with RLS off, so every row is visible. */
async function tenantIds(table: string): Promise<(string | null)[]> {
  await scratch.query(`ALTER TABLE ${table} NO FORCE ROW LEVEL SECURITY`);
  try {
    const res = await scratch.query(`SELECT tenant_id FROM ${table} ORDER BY id`);
    return res.rows.map((r: { tenant_id: string | null }) => r.tenant_id);
  } finally {
    await scratch.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
  }
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

beforeEach(async () => {
  await scratch.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  await scratch.query(`
    CREATE TABLE tenants (id UUID PRIMARY KEY);
    INSERT INTO tenants (id) VALUES ('${TENANT_ID}');
    ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
    ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenants_bypass ON tenants
      USING (current_setting('app.bypass_rls', true) = 'on');
    CREATE TABLE cli_orders (id INT PRIMARY KEY, total INT NOT NULL);
  `);
});

describe("stratum migrate <table> on a table that has rows", () => {
  beforeEach(async () => {
    await scratch.query(`INSERT INTO cli_orders (id, total) VALUES (1, 10), (2, 20)`);
  });

  it("stops without --tenant, names the flag, and leaves the table unchanged", async () => {
    const { code, out } = runMigrate(["cli_orders"]);

    expect(code).toBe(1);
    expect(out).toContain("--tenant <uuid>");
    expect(out).toContain("2 existing row");
    expect(await tableState("cli_orders")).toMatchObject({
      has_tenant_id: false,
      has_policy: false,
    });
  });

  it("assigns every existing row to the --tenant tenant and completes the migration", async () => {
    const { code, out } = runMigrate(["cli_orders", "--tenant", TENANT_ID]);

    expect(out).toContain("Migration complete for cli_orders");
    expect(code).toBe(0);
    expect(await tableState("cli_orders")).toEqual({
      has_tenant_id: true,
      tenant_id_nullable: false,
      rls_forced: true,
      has_policy: true,
      fk_validated: true,
    });
    expect(await tenantIds("cli_orders")).toEqual([TENANT_ID, TENANT_ID]);
  });

  it("rejects a --tenant that is not in the tenants table and leaves the table unchanged", async () => {
    const { code, out } = runMigrate(["cli_orders", "--tenant", UNKNOWN_TENANT_ID]);

    expect(code).toBe(1);
    expect(out).toContain(`Tenant "${UNKNOWN_TENANT_ID}" does not exist`);
    expect((await tableState("cli_orders")).has_tenant_id).toBe(false);
  });

  it("rejects the nil UUID as --tenant", async () => {
    const { code, out } = runMigrate(["cli_orders", "--tenant", NIL_UUID]);

    expect(code).toBe(1);
    expect(out).toContain("nil UUID");
    expect((await tableState("cli_orders")).has_tenant_id).toBe(false);
  });
});

describe("stratum migrate <table> on an empty table", () => {
  it("completes without --tenant and makes tenant_id NOT NULL", async () => {
    const { code, out } = runMigrate(["cli_orders"]);

    expect(out).toContain("Migration complete for cli_orders");
    expect(code).toBe(0);
    expect(await tableState("cli_orders")).toEqual({
      has_tenant_id: true,
      tenant_id_nullable: false,
      rls_forced: true,
      has_policy: true,
      fk_validated: true,
    });
  });
});
