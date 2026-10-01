import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { inspectRoleModel, migrate } from "@stratum-hq/lib";
import {
  APP_READ_TABLES,
  BASE_URL,
  ROLE_PREFIX,
  dropTestRole,
  errorCode,
  scratchDatabase,
  urlFor,
} from "./helpers/role-model.js";

/**
 * Runs the stratum-init-db.sql that `stratum scaffold docker` writes against
 * real PostgreSQL, the way the postgres image runs it: once, as the
 * bootstrap superuser. Roles are cluster-wide, so the test renames the three
 * roles and the database before it applies the file. It then migrates as the
 * admin login, as the control plane does with DATABASE_ADMIN_URL, and checks
 * the role model: the control role is applied, the admin login is neither
 * superuser nor BYPASSRLS, and the application login has no privilege on the
 * Stratum tables until `stratum db roles --apply` grants the read list.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, "../../cli/dist/index.js");

const DB = scratchDatabase("cli_scaffold_docker");
const CONTROL = `${ROLE_PREFIX}dk_control`;
const ADMIN = `${ROLE_PREFIX}dk_admin`;
const APP = `${ROLE_PREFIX}dk_app`;
const suUrl = urlFor({ database: DB });
const adminUrl = urlFor({ user: ADMIN, password: "stratum_dev", database: DB });
const appUrl = urlFor({ user: APP, password: "stratum_dev", database: DB });

let su: pg.Client;
let suPool: pg.Pool;
let adminPool: pg.Pool;
let appPool: pg.Pool;
let outDir: string;

function runCli(args: string[]): { code: number | null; out: string } {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "test", NO_COLOR: "1", DATABASE_ADMIN_URL: "" },
    timeout: 60000,
  });
  return { code: res.status, out: `${res.stdout}${res.stderr}` };
}

beforeAll(async () => {
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), "stratum-scaffold-docker-"));
  const scaffolded = runCli(["scaffold", "docker", "--out", outDir]);
  expect(scaffolded.code, scaffolded.out).toBe(0);
  const sql = fs
    .readFileSync(path.join(outDir, "stratum-init-db.sql"), "utf8")
    .replace(/\bstratum_control\b/g, CONTROL)
    .replace(/\bstratum_admin\b/g, ADMIN)
    .replace(/\bstratum_app\b/g, APP)
    .replace(/ON DATABASE stratum\b/g, `ON DATABASE "${DB}"`);

  su = new pg.Client({ connectionString: BASE_URL });
  await su.connect();
  await su.query(`DROP DATABASE IF EXISTS "${DB}"`);
  for (const role of [APP, ADMIN, CONTROL]) await dropTestRole(su, role);
  await su.query(`CREATE DATABASE "${DB}"`);
  suPool = new pg.Pool({ connectionString: suUrl, max: 2 });
  await suPool.query(sql);

  adminPool = new pg.Pool({ connectionString: adminUrl, max: 2 });
  appPool = new pg.Pool({ connectionString: appUrl, max: 2 });
  await migrate({ pool: adminPool, controlRole: CONTROL });
}, 120_000);

afterAll(async () => {
  await appPool?.end();
  await adminPool?.end();
  await suPool?.end();
  await su?.query(`DROP DATABASE IF EXISTS "${DB}"`);
  for (const role of [APP, ADMIN, CONTROL]) await dropTestRole(su, role);
  await su?.end();
  fs.rmSync(outDir, { recursive: true, force: true });
});

describe("stratum scaffold docker: stratum-init-db.sql", () => {
  it("creates a NOLOGIN control role and two logins without SUPERUSER or BYPASSRLS", async () => {
    const res = await suPool.query(
      `SELECT rolname, rolcanlogin, rolsuper, rolbypassrls, rolcreaterole
         FROM pg_roles WHERE rolname = ANY($1) ORDER BY rolname`,
      [[CONTROL, ADMIN, APP]],
    );
    expect(res.rows).toEqual(
      [
        { rolname: ADMIN, rolcanlogin: true, rolsuper: false, rolbypassrls: false, rolcreaterole: false },
        { rolname: APP, rolcanlogin: true, rolsuper: false, rolbypassrls: false, rolcreaterole: false },
        { rolname: CONTROL, rolcanlogin: false, rolsuper: false, rolbypassrls: false, rolcreaterole: false },
      ].sort((a, b) => a.rolname.localeCompare(b.rolname)),
    );
  });

  it("lets the admin login migrate and apply the control role, and owns the Stratum tables", async () => {
    const report = await inspectRoleModel({ appPool, adminPool, controlRole: CONTROL });
    expect(report.migrated).toBe(true);
    expect(report.hardeningActive).toBe(true);
    expect(report.adminIssues).toEqual([]);
    const owner = await suPool.query("SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'tenants'");
    expect(owner.rows[0].tableowner).toBe(ADMIN);
  });

  it("gives the application login no membership and no privilege on the Stratum tables", async () => {
    const member = await suPool.query("SELECT pg_has_role($1, $2, 'MEMBER') AS m", [APP, CONTROL]);
    expect(member.rows[0].m).toBe(false);
    const privileged = await suPool.query(
      `SELECT c.relname FROM pg_class c
        WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
          AND (has_table_privilege($1, c.oid, 'SELECT') OR has_table_privilege($1, c.oid, 'INSERT')
               OR has_table_privilege($1, c.oid, 'UPDATE') OR has_table_privilege($1, c.oid, 'DELETE'))`,
      [APP],
    );
    expect(privileged.rows).toEqual([]);
    expect(await errorCode(() => appPool.query("SELECT 1 FROM api_keys"))).toBe("42501");
  });

  it("lets the application login create its own tables", async () => {
    await appPool.query("CREATE TABLE dk_orders (id INT PRIMARY KEY, tenant_id UUID)");
    const owner = await suPool.query("SELECT tableowner FROM pg_tables WHERE tablename = 'dk_orders'");
    expect(owner.rows[0].tableowner).toBe(APP);
  });

  it("then grants the read list, and nothing else, with the db roles command the file names", async () => {
    const res = runCli([
      "db", "roles", "--apply", "--database-url", suUrl,
      "--admin-role", ADMIN, "--app-role", APP, "--control-role", CONTROL,
    ]);
    expect(res.code, res.out).toBe(0);
    for (const table of APP_READ_TABLES) {
      const ok = await suPool.query("SELECT has_table_privilege($1, $2, 'SELECT') AS ok", [APP, `public.${table}`]);
      expect({ table, ok: ok.rows[0].ok }).toEqual({ table, ok: true });
    }
    expect(await errorCode(() => appPool.query("SELECT 1 FROM api_keys"))).toBe("42501");
    expect(await errorCode(() => appPool.query("INSERT INTO tenants (name, slug, ancestry_path) VALUES ('x', 'x', 'x')"))).toBe("42501");
  });
});
