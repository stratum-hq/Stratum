import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool, closePool, runMigrations } from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

/**
 * Runs the built `stratum` CLI against the migrated Stratum schema while
 * connected as a NON-superuser, NOBYPASSRLS role: the role the CLI defaults to
 * (stratum_app) and the one `stratum health` requires. Migration 019 puts
 * FORCE RLS on tenants and api_keys, so these commands see and write rows only
 * when they set the documented bypass context.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, "../../cli/dist/index.js");

const BASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://stratum_test:stratum_test@localhost:5433/stratum_test";

const APP_ROLE = "stratum_cli_app_test";
const appUrl = (() => {
  const u = new URL(BASE_URL);
  u.username = APP_ROLE;
  u.password = APP_ROLE;
  return u.toString();
})();

function runCli(args: string[]): { code: number | null; out: string } {
  const res = spawnSync(process.execPath, [CLI, ...args, "--database-url", appUrl], {
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "test" },
    timeout: 30000,
  });
  // eslint-disable-next-line no-control-regex
  const out = `${res.stdout}${res.stderr}`.replace(/\x1b\[[0-9;]*m/g, "");
  return { code: res.status, out };
}

const keyName = `cli_key_${Date.now()}`;
let tenantId: string;
let childId: string;

beforeAll(async () => {
  await runMigrations();
  const pool = getPool();
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
        CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_ROLE}' NOSUPERUSER NOBYPASSRLS;
      END IF;
    END $$;
  `);
  await pool.query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
  await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`);
  await pool.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE}`);

  const slug = uniqueSlug("cli");
  const t = await pool.query(
    `INSERT INTO tenants (name, slug, ancestry_path) VALUES ($1, $2, $2) RETURNING id`,
    [`CLI ${slug}`, slug],
  );
  tenantId = t.rows[0].id;
  const c = await pool.query(
    `INSERT INTO tenants (parent_id, name, slug, ancestry_path, depth) VALUES ($1, $2, $3, $4, 1) RETURNING id`,
    [tenantId, `CLI child ${slug}`, `${slug}_c`, `${slug}.${slug}_c`],
  );
  childId = c.rows[0].id;
  // An expired key nobody revoked: exactly what doctor exists to report.
  await pool.query(
    `INSERT INTO api_keys (tenant_id, key_hash, key_prefix, name, expires_at)
     VALUES ($1, $2, 'sk_test_cli', $3, now() - interval '1 day')`,
    [tenantId, `cli_expired_${Date.now()}`, `${keyName}_expired`],
  );
});

afterAll(async () => {
  const pool = getPool();
  await pool.query(`DELETE FROM api_keys WHERE name LIKE $1`, [`${keyName}%`]);
  await pool.query(`DELETE FROM tenants WHERE id = $1`, [childId]);
  await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  await pool.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${APP_ROLE}`);
  await pool.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${APP_ROLE}`);
  await pool.query(`REVOKE ALL ON SCHEMA public FROM ${APP_ROLE}`);
  await closePool();
});

describe("CLI as a NOBYPASSRLS application role", () => {
  it("connects as a role that is neither superuser nor BYPASSRLS", async () => {
    const res = await getPool().query(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1`,
      [APP_ROLE],
    );
    expect(res.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it("generate api-key creates a tenant key", async () => {
    const { code, out } = runCli(["generate", "api-key", "--name", `${keyName}_tenant`, "--tenant", tenantId]);
    expect(out).toContain("API key generated successfully");
    expect(code).toBe(0);
    const row = await getPool().query(`SELECT tenant_id FROM api_keys WHERE name = $1`, [`${keyName}_tenant`]);
    expect(row.rows).toEqual([{ tenant_id: tenantId }]);
  });

  it("generate api-key creates a global key", async () => {
    const { code, out } = runCli(["generate", "api-key", "--name", `${keyName}_global`]);
    expect(out).toContain("API key generated successfully");
    expect(code).toBe(0);
    const row = await getPool().query(`SELECT tenant_id FROM api_keys WHERE name = $1`, [`${keyName}_global`]);
    expect(row.rows).toEqual([{ tenant_id: null }]);
  });

  it("doctor reports the expired, unrevoked key instead of a false pass", () => {
    const { out } = runCli(["doctor"]);
    expect(out).not.toContain("No expired unrevoked keys");
    expect(out).toMatch(/\d+ expired key\(s\) not yet revoked/);
    expect(out).toContain(`${keyName}_expired`);
  });

  it("doctor measures tree depth over the real tenant rows", () => {
    const { out } = runCli(["doctor"]);
    // A depth-1 tenant is seeded, so a check that can see the rows reports at
    // least 1. Without visibility it reads zero rows and reports 0.
    const m = out.match(/Tree depth\s+Max depth: (\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(1);
  });
});
