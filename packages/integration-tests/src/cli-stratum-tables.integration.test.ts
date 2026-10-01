import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

/**
 * Runs the built `stratum` CLI (packages/cli/dist) against a database that has
 * every Stratum migration applied. The CLI must treat Stratum's own tables as
 * Stratum's: `scan` and `migrate --all` report them as nothing to do, and the
 * SQL from `scan --generate` applies as written.
 *
 * The tests use their own scratch database, so the only tables in it are
 * Stratum's and the ones these tests create. The scratch database is dropped
 * afterwards.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, "../../cli/dist/index.js");
const MIGRATIONS_DIR = path.resolve(__dirname, "../../lib/src/migrations");

const BASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://stratum_test:stratum_test@localhost:5433/stratum_test";

const scratchDbName = `${new URL(BASE_URL).pathname.slice(1)}_cli_stratum_tables`;
const scratchUrl = (() => {
  const u = new URL(BASE_URL);
  u.pathname = `/${scratchDbName}`;
  return u.toString();
})();

function runCli(args: string[]): { code: number | null; out: string; stdout: string } {
  const res = spawnSync(process.execPath, [CLI, ...args, "--database-url", scratchUrl], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    input: "n\n",
    timeout: 30000,
  });
  // eslint-disable-next-line no-control-regex
  const out = `${res.stdout}${res.stderr}`.replace(/\x1b\[[0-9;]*m/g, "");
  return { code: res.status, out, stdout: res.stdout };
}

/** The SQL block `scan --generate` prints to stdout (the report goes to stderr). */
function generatedSql(out: string): string {
  const start = out.indexOf("-- Stratum Migration Scanner");
  expect(start).toBeGreaterThanOrEqual(0);
  return out.slice(start);
}

/**
 * Applies every lib migration in file order. The test role has BYPASSRLS, so
 * the 001 check that refuses such a role is removed, as helpers/db.ts does.
 */
async function applyStratumMigrations(client: pg.Client): Promise<void> {
  await client.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
  await client.query(`CREATE EXTENSION IF NOT EXISTS ltree`);
  await client.query(`CREATE TABLE _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = fs
      .readFileSync(path.join(MIGRATIONS_DIR, file), "utf8")
      .replace(/DO \$\$ BEGIN[\s\S]*?END \$\$;/, "-- BYPASSRLS check skipped");
    await client.query(sql);
    await client.query(`INSERT INTO _migrations (name) VALUES ($1)`, [file]);
  }
}

let admin: pg.Client;
let scratch: pg.Client;

beforeAll(async () => {
  admin = new pg.Client({ connectionString: BASE_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${scratchDbName}"`);
  await admin.query(`CREATE DATABASE "${scratchDbName}"`);
  scratch = new pg.Client({ connectionString: scratchUrl });
  await scratch.connect();
  await applyStratumMigrations(scratch);
});

afterAll(async () => {
  await scratch?.end();
  await admin?.query(`DROP DATABASE IF EXISTS "${scratchDbName}"`);
  await admin?.end();
});

describe("CLI on a fully migrated Stratum database", () => {
  it("scan reports no Stratum table", async () => {
    const { rows } = await scratch.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    );
    expect(rows.map((r) => r.tablename)).toContain("principal_roles");

    const { code, out } = runCli(["scan"]);
    expect(code).toBe(0);
    expect(out).toContain("Found 0 tables in public schema.");
    for (const { tablename } of rows) {
      expect(out).not.toMatch(new RegExp(`[✓✗⚠] ${tablename}\\b`));
    }
  });

  it("migrate --all finds no table to migrate", () => {
    const { out } = runCli(["migrate", "--all"]);
    expect(out).toContain("All tables are already migrated!");
    expect(out).not.toContain("principal_roles");
  });
});

describe("CLI scan --generate on a fully migrated Stratum database", () => {
  beforeAll(async () => {
    await scratch.query(`
      CREATE TABLE cli_orders (id UUID PRIMARY KEY);
      CREATE TABLE cli_notes (id UUID PRIMARY KEY);
      CREATE POLICY tenant_isolation ON cli_notes USING (true);
    `);
  });

  it("emits CREATE POLICY only for a table that has no tenant_isolation policy", () => {
    const sql = generatedSql(runCli(["scan", "--generate"]).stdout);
    expect(sql).toContain(`CREATE POLICY tenant_isolation ON "cli_orders"`);
    expect(sql).not.toContain(`CREATE POLICY tenant_isolation ON "cli_notes"`);
    expect(sql).not.toContain("principal_roles");
  });

  it("emits SQL that applies without error and leaves Stratum tables unchanged", async () => {
    const sql = generatedSql(runCli(["scan", "--generate"]).stdout);
    await scratch.query(sql);

    const res = await scratch.query(`
      SELECT c.relname, c.relforcerowsecurity,
        EXISTS (SELECT 1 FROM information_schema.columns col
                WHERE col.table_schema = 'public' AND col.table_name = c.relname
                  AND col.column_name = 'tenant_id') AS has_tenant_id
      FROM pg_class c
      WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('cli_orders', 'cli_notes', 'principal_roles')
      ORDER BY c.relname
    `);
    expect(res.rows).toEqual([
      { relname: "cli_notes", relforcerowsecurity: true, has_tenant_id: true },
      { relname: "cli_orders", relforcerowsecurity: true, has_tenant_id: true },
      { relname: "principal_roles", relforcerowsecurity: true, has_tenant_id: false },
    ]);
  });
});
