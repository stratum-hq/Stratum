import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "@stratum-hq/lib";
import { BASE_URL, ROLE_PREFIX, dropTestRole, scratchDatabase, urlFor } from "./helpers/role-model.js";

/**
 * `stratum db roles --apply` runs the bootstrap SQL as a superuser on tables
 * the application login owned until then. Whatever that login attached to
 * them (a changed Stratum function, a trigger, a column default) would run
 * with the rights of the superuser now, or of the admin login later. The
 * bootstrap SQL checks for such objects first and stops, changing nothing.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, "../../cli/dist/index.js");

const DB = scratchDatabase("cli_roles_integrity");
const APP = `${ROLE_PREFIX}integrity_app`;
const ADMIN = `${ROLE_PREFIX}integrity_admin`;
const PASSWORD = "integrity_pw";

const suUrl = urlFor({ database: DB });
const appUrl = urlFor({ user: APP, password: PASSWORD, database: DB });

let su: pg.Client;
let suPool: pg.Pool;
let appPool: pg.Pool;

function runCli(args: string[]): { code: number | null; out: string } {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "test", DATABASE_ADMIN_URL: "" },
    timeout: 60000,
  });
  // eslint-disable-next-line no-control-regex
  return { code: res.status, out: `${res.stdout}${res.stderr}`.replace(/\x1b\[[0-9;]*m/g, "") };
}

/** The output line of a doctor check. */
function line(out: string, label: string): string {
  return out.split("\n").find((l) => l.includes(label)) ?? `(no line for ${label})\n${out}`;
}

function applyRoles(): { code: number | null; out: string } {
  const res = spawnSync(
    process.execPath,
    [CLI, "db", "roles", "--apply", "--database-url", suUrl, "--admin-role", ADMIN, "--app-role", APP],
    { encoding: "utf8", env: { ...process.env, NODE_ENV: "test" }, timeout: 60000 },
  );
  // eslint-disable-next-line no-control-regex
  return { code: res.status, out: `${res.stdout}${res.stderr}`.replace(/\x1b\[[0-9;]*m/g, "") };
}

/** The bootstrap changed nothing: the application login still owns tenants and no control policy exists. */
async function expectUnchanged(): Promise<void> {
  const owner = await suPool.query("SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'tenants'");
  expect(owner.rows[0].tableowner).toBe(APP);
  const policies = await suPool.query("SELECT 1 FROM pg_policies WHERE policyname = 'stratum_control_plane'");
  expect(policies.rows).toEqual([]);
}

beforeAll(async () => {
  su = new pg.Client({ connectionString: BASE_URL });
  await su.connect();
  await su.query(`DROP DATABASE IF EXISTS "${DB}"`);
  for (const role of [APP, ADMIN]) {
    await dropTestRole(su, role);
    await su.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${PASSWORD}' NOSUPERUSER NOBYPASSRLS`);
  }
  await su.query(`CREATE DATABASE "${DB}"`);
  suPool = new pg.Pool({ connectionString: suUrl, max: 2 });
  await suPool.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
  await suPool.query(`CREATE EXTENSION IF NOT EXISTS ltree`);
  await suPool.query(`GRANT ALL ON SCHEMA public TO "${APP}"`);
  appPool = new pg.Pool({ connectionString: appUrl, max: 2 });
  // A legacy install: the application login migrates and owns every Stratum object.
  await migrate({ pool: appPool });
}, 120_000);

afterAll(async () => {
  await appPool?.end();
  await suPool?.end();
  await su.query(`DROP DATABASE IF EXISTS "${DB}"`);
  for (const role of [APP, ADMIN]) await dropTestRole(su, role);
  await su.end();
});

describe("stratum db roles --apply on tables the application login owned", () => {
  it("refuses to run a stratum_apply_control_role() whose body was changed, so its code never runs as the superuser", async () => {
    const original = await suPool.query(
      "SELECT pg_get_functiondef('public.stratum_apply_control_role(text, text)'::regprocedure) AS def",
    );
    await appPool.query(`
      CREATE OR REPLACE FUNCTION public.stratum_apply_control_role(role_name text, target_schema text)
      RETURNS void LANGUAGE plpgsql AS $fn$
      BEGIN
        EXECUTE 'ALTER ROLE "${APP}" SUPERUSER';
      END;
      $fn$`);
    try {
      const { code, out } = applyRoles();
      expect(code).toBe(1);
      expect(out).toContain("function stratum_apply_control_role has a body the migrations did not give it");
      const role = await suPool.query("SELECT rolsuper FROM pg_roles WHERE rolname = $1", [APP]);
      expect(role.rows[0].rolsuper).toBe(false);
      await expectUnchanged();
    } finally {
      await appPool.query(original.rows[0].def);
    }
  });

  it("refuses a trigger on a Stratum table that calls a function the application login owns", async () => {
    await appPool.query(`
      CREATE FUNCTION public.app_on_key() RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN RETURN NEW; END;
      $fn$`);
    await appPool.query(
      "CREATE TRIGGER app_on_key BEFORE INSERT ON api_keys FOR EACH ROW EXECUTE FUNCTION public.app_on_key()",
    );
    try {
      const { code, out } = applyRoles();
      expect(code).toBe(1);
      expect(out).toContain("trigger app_on_key on api_keys calls app_on_key()");
      await expectUnchanged();
    } finally {
      await appPool.query("DROP TRIGGER app_on_key ON api_keys");
      await appPool.query("DROP FUNCTION public.app_on_key()");
    }
  });

  it("refuses a column default on a Stratum table that calls a function the application login owns", async () => {
    await appPool.query("CREATE FUNCTION public.app_name() RETURNS text LANGUAGE sql AS $fn$ SELECT 'x' $fn$");
    await appPool.query("ALTER TABLE api_keys ALTER COLUMN name SET DEFAULT public.app_name()");
    try {
      const { code, out } = applyRoles();
      expect(code).toBe(1);
      expect(out).toContain("column default on api_keys uses function app_name()");
      await expectUnchanged();
    } finally {
      await appPool.query("ALTER TABLE api_keys ALTER COLUMN name DROP DEFAULT");
      await appPool.query("DROP FUNCTION public.app_name()");
    }
  });

  it("refuses a rule on a Stratum table", async () => {
    await appPool.query("CREATE RULE app_rule AS ON INSERT TO regions DO ALSO NOTIFY app_channel");
    try {
      const { code, out } = applyRoles();
      expect(code).toBe(1);
      expect(out).toContain("rule app_rule on regions");
      await expectUnchanged();
    } finally {
      await appPool.query("DROP RULE app_rule ON regions");
    }
  });

  it("doctor reports a tenant_isolation policy that the former owner changed", async () => {
    await appPool.query("ALTER POLICY tenant_isolation ON tenants USING (true) WITH CHECK (true)");
    const { out } = runCli(["doctor", "--database-url", suUrl]);
    expect(line(out, "Stratum policies")).toMatch(/differ/);
    expect(out).toContain("tenants: policy tenant_isolation");
  });

  it("applies the role model once the tables carry only what the migrations created", async () => {
    const { code, out } = applyRoles();
    expect(code, out).toBe(0);
    expect(out).toContain("Hardening active");
    const owner = await suPool.query("SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'tenants'");
    expect(owner.rows[0].tableowner).toBe(ADMIN);
    const fn = await suPool.query(
      "SELECT pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid = 'public.stratum_apply_control_role(text, text)'::regprocedure",
    );
    expect(fn.rows[0].owner).toBe(ADMIN);
  });

  it("restores the tenant_isolation policy that the former owner changed to USING (true)", async () => {
    const res = await suPool.query(
      "SELECT qual FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tenants' AND policyname = 'tenant_isolation'",
    );
    expect(res.rows[0].qual).toContain("stratum_legacy_bypass()");
    expect(res.rows[0].qual).toContain("app.current_tenant_id");
  });

  it("doctor reports every Stratum policy as canonical after the bootstrap", () => {
    const { out } = runCli(["doctor", "--database-url", suUrl]);
    expect(line(out, "Stratum policies")).toMatch(/match/);
  });
});
