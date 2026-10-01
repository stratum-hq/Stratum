import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { BASE_URL, ROLE_PREFIX, dropTestRole, scratchDatabase, urlFor } from "./helpers/role-model.js";

/**
 * The output contracts of the CLI on real PostgreSQL:
 *
 * - `stratum scan --generate` writes only SQL to stdout, and that SQL runs
 *   against the database it came from and isolates every table it reports.
 * - `stratum health` exits 1 when a check fails and 0 with only warnings.
 * - NO_COLOR removes the ANSI codes.
 * - `stratum migrate` fails, and changes nothing, when stdin closes at its prompt.
 * - `stratum migrate --scan` suggests `stratum migrate <table>` only for
 *   tables that command accepts.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, "../../cli/dist/index.js");

const DB = scratchDatabase("cli_scan_generate");
const APP = `${ROLE_PREFIX}cli_scan_app`;
const PASSWORD = "cli_scan_pw";
const suUrl = urlFor({ database: DB });
const appUrl = urlFor({ user: APP, password: PASSWORD, database: DB });

const TENANT_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const ESC = String.fromCharCode(27);

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], opts: { env?: Record<string, string | undefined>; input?: string } = {}): Run {
  const env: Record<string, string | undefined> = { ...process.env, NODE_ENV: "test", DATABASE_ADMIN_URL: "" };
  delete env.NO_COLOR;
  Object.assign(env, opts.env);
  const res = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: env as NodeJS.ProcessEnv,
    input: opts.input ?? "",
    timeout: 30000,
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

let su: pg.Client;
let db: pg.Client;

beforeAll(async () => {
  su = new pg.Client({ connectionString: BASE_URL });
  await su.connect();
  await su.query(`DROP DATABASE IF EXISTS "${DB}"`);
  await dropTestRole(su, APP);
  await su.query(`CREATE ROLE "${APP}" LOGIN PASSWORD '${PASSWORD}' NOSUPERUSER NOBYPASSRLS`);
  await su.query(`CREATE DATABASE "${DB}"`);
  db = new pg.Client({ connectionString: suUrl });
  await db.connect();
});

afterAll(async () => {
  await db?.end();
  await su?.query(`DROP DATABASE IF EXISTS "${DB}"`);
  await dropTestRole(su, APP);
  await su?.end();
});

/** Application tables in every state that scan reports. */
async function seedTables(withTenants: boolean): Promise<void> {
  await db.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  if (withTenants) {
    await db.query(`CREATE TABLE tenants (id UUID PRIMARY KEY); INSERT INTO tenants VALUES ('${TENANT_ID}');`);
  }
  await db.query(`
    CREATE TABLE orders (id INT PRIMARY KEY, total INT);
    INSERT INTO orders VALUES (1, 10), (2, 20);
    CREATE TABLE "Order Lines" (id INT PRIMARY KEY);
    CREATE TABLE invoices (id INT PRIMARY KEY, tenant_id UUID);
    CREATE TABLE items (id INT PRIMARY KEY, tenant_id UUID);
    ALTER TABLE items ENABLE ROW LEVEL SECURITY;
    CREATE TABLE notes (id INT PRIMARY KEY, tenant_id UUID);
    ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON notes
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
  `);
}

describe("stratum scan --generate", () => {
  for (const withTenants of [true, false]) {
    describe(withTenants ? "with a tenants table" : "without a tenants table", () => {
      let gen: Run;

      beforeEach(async () => {
        await seedTables(withTenants);
        gen = runCli(["scan", "--generate", "--database-url", suUrl]);
      });

      it("writes only SQL to stdout and the report to stderr", () => {
        expect(gen.code, gen.stderr).toBe(0);
        expect(gen.stdout).not.toContain(ESC);
        expect(gen.stdout.trimStart().startsWith("-- Stratum Migration Scanner")).toBe(true);
        expect(gen.stdout).not.toMatch(/Scanning database|Summary:/);
        expect(gen.stderr).toContain("Summary: 5 table(s) need migration");
      });

      it("produces SQL that runs and leaves every table isolated", async () => {
        await db.query(gen.stdout);

        const rescan = runCli(["scan", "--database-url", suUrl]);
        expect(rescan.code, rescan.stdout + rescan.stderr).toBe(0);
        expect(rescan.stdout).toContain("All tables are properly isolated");

        const fk = await db.query(
          `SELECT count(*)::int AS n FROM pg_constraint WHERE contype = 'f' AND confrelid = to_regclass('public.tenants')`,
        );
        expect(fk.rows[0].n).toBe(withTenants ? 2 : 0);
        const forced = await db.query(
          `SELECT count(*)::int AS n FROM pg_class
            WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relforcerowsecurity`,
        );
        expect(forced.rows[0].n).toBe(5);
      });
    });
  }
});

describe("stratum health exit code", () => {
  beforeAll(async () => {
    await db.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
    await db.query(`GRANT USAGE ON SCHEMA public TO "${APP}"`);
  });

  it("exits 1 when an extension is missing", async () => {
    await db.query(`DROP EXTENSION IF EXISTS ltree`);
    await db.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    const res = runCli(["health", "--database-url", appUrl]);
    expect(res.code, res.stdout).toBe(1);
    expect(res.stdout).toMatch(/Extension: ltree \(missing/);
  });

  it("exits 1 when the login has BYPASSRLS", async () => {
    await db.query(`CREATE EXTENSION IF NOT EXISTS ltree`);
    const res = runCli(["health", "--database-url", suUrl]);
    expect(res.code, res.stdout).toBe(1);
    expect(res.stdout).toContain("BYPASSRLS");
  });

  it("exits 0 with only warnings", async () => {
    // No Stratum schema yet: a warning, not a failure.
    const res = runCli(["health", "--database-url", appUrl]);
    expect(res.stdout).toContain("Stratum schema not found");
    expect(res.code, res.stdout).toBe(0);
  });
});

describe("NO_COLOR", () => {
  it("removes the ANSI codes from the output", () => {
    const colored = runCli(["health", "--database-url", appUrl]);
    const plain = runCli(["health", "--database-url", appUrl], { env: { NO_COLOR: "1" } });
    expect(colored.stdout).toContain(ESC);
    expect(plain.stdout).not.toContain(ESC);
    expect(plain.stdout).toContain("Database connection OK");
  });
});

describe("stratum migrate", () => {
  beforeEach(async () => {
    await seedTables(true);
    await db.query(`
      CREATE TABLE open_notes (id INT PRIMARY KEY, tenant_id UUID);
      ALTER TABLE open_notes ENABLE ROW LEVEL SECURITY;
      CREATE POLICY open_all ON open_notes USING (true);
    `);
  });

  it("exits 1 and changes nothing when stdin closes at the prompt", async () => {
    const res = runCli(["migrate", "invoices", "--database-url", suUrl], { input: "" });
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("Input closed before an answer was given");
    const rls = await db.query(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public.invoices'::regclass`);
    expect(rls.rows[0].relrowsecurity).toBe(false);
  });

  it("--scan suggests stratum migrate only for tables that migrate accepts", () => {
    const res = runCli(["migrate", "--scan", "--database-url", suUrl], { env: { NO_COLOR: "1" } });
    expect(res.code, res.stdout + res.stderr).toBe(0);
    const suggested = [...res.stdout.matchAll(/^\s+stratum migrate (\S+)$/gm)].map((m) => m[1]).sort();
    expect(suggested).toEqual(["invoices", "items", "notes", "orders"]);
    expect(res.stdout).toContain("Order Lines");
    expect(res.stdout).toContain("open_notes");
  });

  it("each suggested command is accepted by migrate", async () => {
    const scan = runCli(["migrate", "--scan", "--database-url", suUrl], { env: { NO_COLOR: "1" } });
    const suggested = [...scan.stdout.matchAll(/^\s+stratum migrate (\S+)$/gm)].map((m) => m[1]);
    for (const table of suggested) {
      const res = runCli(["migrate", table, "--tenant", TENANT_ID, "--database-url", suUrl], { input: "y\n" });
      expect(res.code, `${table}: ${res.stdout}${res.stderr}`).toBe(0);
    }
  });
});
