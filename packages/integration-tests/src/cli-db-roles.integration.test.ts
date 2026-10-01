import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate, noopLogger, Stratum } from "@stratum-hq/lib";
import {
  APP_READ_TABLES,
  BASE_URL,
  ROLE_PREFIX,
  controlRoleName,
  dropTestRole,
  scratchDatabase,
  urlFor,
} from "./helpers/role-model.js";

/**
 * `stratum db roles`, `db lock` / `db unlock`, and the role-model checks of
 * `doctor` and `health`, on real PostgreSQL.
 *
 * The database starts as a legacy single-role install: the application
 * login (not a superuser, no CREATEROLE) ran the migrations, so it owns every
 * Stratum table, and migration 032 could not apply the control role. It also
 * owns an application table. The operator then creates an admin login and
 * runs `stratum db roles --apply` as a superuser.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, "../../cli/dist/index.js");

const DB = scratchDatabase("cli_roles");
const APP = `${ROLE_PREFIX}cli_roles_app`;
const ADMIN = `${ROLE_PREFIX}cli_roles_admin`;
const PASSWORD = "cli_roles_pw";

const suUrl = urlFor({ database: DB });
const appUrl = urlFor({ user: APP, password: PASSWORD, database: DB });
const adminUrl = urlFor({ user: ADMIN, password: PASSWORD, database: DB });

let su: pg.Client;
let suPool: pg.Pool;
let control: string;
let tenantId: string;

function runCli(args: string[], input?: string): { code: number | null; out: string } {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "test", STRATUM_ENCRYPTION_KEY: "x".repeat(40), DATABASE_ADMIN_URL: "" },
    input,
    timeout: 60000,
  });
  // eslint-disable-next-line no-control-regex
  const out = `${res.stdout}${res.stderr}`.replace(/\x1b\[[0-9;]*m/g, "");
  return { code: res.status, out };
}

/** The output line of a doctor or health check. */
function line(out: string, label: string): string {
  return out.split("\n").find((l) => l.includes(label)) ?? `(no line for ${label})\n${out}`;
}

async function legacySwitch(): Promise<boolean> {
  const res = await suPool.query("SELECT legacy_guc_bypass FROM stratum_security");
  return res.rows[0].legacy_guc_bypass;
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
  control = await controlRoleName(suPool);
  await suPool.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
  await suPool.query(`CREATE EXTENSION IF NOT EXISTS ltree`);
  // The grants older setups gave the application login (docker/init-db.sql before 1.8).
  await suPool.query(`GRANT ALL ON SCHEMA public TO "${APP}"`);

  const appPool = new pg.Pool({ connectionString: appUrl, max: 2 });
  try {
    await migrate({ pool: appPool });
    const stratum = new Stratum({ pool: appPool, logger: noopLogger });
    tenantId = (await stratum.createTenant({ name: "Roles A", slug: "cli_roles_a" })).id;
    await stratum.createTenant({ name: "Roles A1", slug: "cli_roles_a1", parent_id: tenantId });
    await appPool.query("CREATE TABLE notes (id serial PRIMARY KEY, body text)");
    await appPool.query("INSERT INTO notes (body) VALUES ('one'), ('two')");
  } finally {
    await appPool.end();
  }
}, 120_000);

afterAll(async () => {
  await suPool?.end();
  await su.query(`DROP DATABASE IF EXISTS "${DB}"`);
  for (const role of [APP, ADMIN]) await dropTestRole(su, role);
  await su.end();
});

describe("before stratum db roles: a legacy install owned by the application login", () => {
  it("has no control policies, because the migrating login could not create the control role", async () => {
    const res = await suPool.query("SELECT 1 FROM pg_policies WHERE policyname = 'stratum_control_plane'");
    expect(res.rows).toEqual([]);
  });

  it("doctor warns that the hardening is not active", () => {
    const { out } = runCli(["doctor", "--database-url", appUrl]);
    expect(line(out, "Control role")).toMatch(/Hardening not active/);
    expect(out).toContain("stratum db roles --apply");
    expect(line(out, "Stratum policies")).toMatch(/match migration 032/);
  });

  it("db lock refuses while the control role is not applied, and leaves the switch on", async () => {
    const { code, out } = runCli(["db", "lock", "--database-url", suUrl]);
    expect(code).toBe(1);
    expect(out).toMatch(/hardening not active/i);
    expect(await legacySwitch()).toBe(true);
  });

  it("db roles without --apply prints the bootstrap SQL and changes nothing", async () => {
    const { code, out } = runCli([
      "db", "roles", "--admin-role", ADMIN, "--app-role", APP, "--control-role", control,
    ]);
    expect(code).toBe(0);
    expect(out).toContain(`CREATE ROLE "${control}" NOLOGIN`);
    expect(out).toContain(`stratum_apply_control_role('${control}', 'public')`);
    const owner = await suPool.query("SELECT tableowner FROM pg_tables WHERE tablename = 'tenants'");
    expect(owner.rows[0].tableowner).toBe(APP);
  });
});

describe("stratum db roles --apply as a superuser", () => {
  let applied: { code: number | null; out: string };

  beforeAll(() => {
    applied = runCli([
      "db", "roles", "--apply", "--database-url", suUrl, "--admin-role", ADMIN, "--app-role", APP,
    ]);
  });

  it("succeeds and reports the hardening as active with the database's control role", () => {
    expect(applied.code, applied.out).toBe(0);
    expect(applied.out).toContain(`Hardening active (control role ${control})`);
  });

  it("moves every Stratum table and function to the admin login and leaves application tables alone", async () => {
    const tables = await suPool.query(
      "SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'public' AND tableowner = $1 ORDER BY 1",
      [APP],
    );
    expect(tables.rows).toEqual([{ tablename: "notes", tableowner: APP }]);
    const fns = await suPool.query(
      `SELECT p.proname FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
          AND p.proowner = (SELECT oid FROM pg_roles WHERE rolname = $1)`,
      [APP],
    );
    expect(fns.rows).toEqual([]);
  });

  it("makes the admin login a member of the control role and not the application login", async () => {
    const res = await suPool.query(
      `SELECT pg_has_role($1, $3, 'USAGE') AS admin, pg_has_role($2, $3, 'MEMBER') AS app`,
      [ADMIN, APP, control],
    );
    expect(res.rows[0]).toEqual({ admin: true, app: false });
  });

  it("limits the application login to SELECT on the read-list tables", async () => {
    const res = await suPool.query(
      `SELECT c.relname,
              has_table_privilege($1, c.oid, 'SELECT') AS can_select,
              has_table_privilege($1, c.oid, 'INSERT') OR has_table_privilege($1, c.oid, 'UPDATE')
                OR has_table_privilege($1, c.oid, 'DELETE') OR has_table_privilege($1, c.oid, 'TRUNCATE') AS can_write
         FROM pg_class c
        WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname <> ALL ($2::text[])
          AND c.relname IN (SELECT tablename FROM pg_policies WHERE policyname = 'stratum_control_plane')`,
      [APP, ["notes"]],
    );
    expect(res.rows.length).toBeGreaterThan(APP_READ_TABLES.length);
    for (const row of res.rows) {
      expect({ table: row.relname, select: row.can_select, write: row.can_write }).toEqual({
        table: row.relname,
        select: (APP_READ_TABLES as readonly string[]).includes(row.relname),
        write: false,
      });
    }
  });
});

describe("after stratum db roles --apply", () => {
  it("doctor with --admin-database-url passes the role-model checks and reads tenants as the control role", () => {
    const { out } = runCli(["doctor", "--database-url", appUrl, "--admin-database-url", adminUrl]);
    expect(line(out, "Control role")).toMatch(/Hardening active/);
    expect(line(out, "App role")).toMatch(/Not a member or owner/);
    expect(line(out, "Admin role")).toMatch(/Can act as the control plane/);
    expect(line(out, "Legacy switch")).toMatch(/On:/);
    expect(line(out, "Stratum policies")).toMatch(/match migration 032/);
    expect(out).not.toContain("legacy app.bypass_rls path");
    const depth = out.match(/Tree depth\s+Max depth: (\d+)/);
    expect(depth, out).not.toBeNull();
    expect(Number(depth![1])).toBe(1);
  });

  it("health reports the role model of the application login", () => {
    const { out } = runCli(["health", "--database-url", appUrl]);
    expect(out).toContain("Control role: Hardening active");
    expect(out).toContain("App role: Not a member or owner");
  });

  it("db lock refuses a login that is not a member of the control role, and leaves the switch on", async () => {
    const { code, out } = runCli(["db", "lock", "--database-url", appUrl]);
    expect(code).toBe(1);
    expect(out).toContain("cannot change the legacy switch");
    expect(await legacySwitch()).toBe(true);
  });

  it("db lock as the admin login turns the legacy switch off", async () => {
    const { code, out } = runCli(["db", "lock", "--admin-database-url", adminUrl]);
    expect(code, out).toBe(0);
    expect(await legacySwitch()).toBe(false);
  });

  it("doctor reports the switch as off", () => {
    const { out } = runCli(["doctor", "--database-url", appUrl, "--admin-database-url", adminUrl]);
    expect(line(out, "Legacy switch")).toMatch(/Off:/);
  });

  it("doctor without an admin connection reports its data checks as not run instead of a pass, once locked", () => {
    const { out } = runCli(["doctor", "--database-url", appUrl]);
    expect(out).toContain("using the legacy app.bypass_rls path");
    expect(line(out, "Tree depth")).toMatch(/Could not query/);
    expect(line(out, "Tenant parent cycles")).toMatch(/Could not query/);
    expect(out).toContain("legacy app.bypass_rls path is closed");
  });

  it("generate api-key with an admin connection inserts the key as the control role", async () => {
    const name = "cli_roles_admin_key";
    const { code, out } = runCli([
      "generate", "api-key", "--name", name, "--tenant", tenantId,
      "--database-url", appUrl, "--admin-database-url", adminUrl,
    ]);
    expect(code, out).toBe(0);
    expect(out).not.toContain("legacy app.bypass_rls path");
    const row = await suPool.query("SELECT tenant_id FROM api_keys WHERE name = $1", [name]);
    expect(row.rows).toEqual([{ tenant_id: tenantId }]);
  });

  it("generate api-key without an admin connection fails once locked, and inserts nothing", async () => {
    const name = "cli_roles_legacy_key";
    const { code } = runCli(["generate", "api-key", "--name", name, "--database-url", appUrl]);
    expect(code).toBe(1);
    const row = await suPool.query("SELECT 1 FROM api_keys WHERE name = $1", [name]);
    expect(row.rows).toEqual([]);
  });

  it("migrate --tenant names the REFERENCES grant the application login lacks, and changes nothing", async () => {
    const { code, out } = runCli(
      ["migrate", "notes", "--tenant", tenantId, "--database-url", appUrl, "--admin-database-url", adminUrl],
      "y\n",
    );
    expect(code).toBe(1);
    expect(out).toContain("GRANT REFERENCES (id) ON tenants");
    const col = await suPool.query(
      "SELECT 1 FROM information_schema.columns WHERE table_name = 'notes' AND column_name = 'tenant_id'",
    );
    expect(col.rows).toEqual([]);
  });

  it("migrate --tenant looks the tenant up as the control role once locked, after db roles --grant-references", async () => {
    const granted = runCli([
      "db", "roles", "--apply", "--grant-references", "--database-url", suUrl, "--admin-role", ADMIN, "--app-role", APP,
    ]);
    expect(granted.code, granted.out).toBe(0);
    const priv = await suPool.query("SELECT has_column_privilege($1, 'tenants', 'id', 'REFERENCES') AS ok", [APP]);
    expect(priv.rows[0].ok).toBe(true);
    const { code, out } = runCli(
      ["migrate", "notes", "--tenant", tenantId, "--database-url", appUrl, "--admin-database-url", adminUrl],
      "y\n",
    );
    expect(code, out).toBe(0);
    const rows = await suPool.query("SELECT DISTINCT tenant_id FROM notes");
    expect(rows.rows).toEqual([{ tenant_id: tenantId }]);
  });

  it("doctor warns when the application login owns the schema of the Stratum tables", async () => {
    await suPool.query(`ALTER SCHEMA public OWNER TO "${APP}"`);
    try {
      const { out } = runCli(["doctor", "--database-url", appUrl, "--admin-database-url", adminUrl]);
      expect(line(out, "App role")).toMatch(/problem/);
      expect(out).toContain(`owns the schema "public"`);
    } finally {
      await suPool.query("ALTER SCHEMA public OWNER TO pg_database_owner");
    }
  });

  it("db unlock as the admin login turns the legacy switch back on", async () => {
    const { code, out } = runCli(["db", "unlock", "--admin-database-url", adminUrl]);
    expect(code, out).toBe(0);
    expect(await legacySwitch()).toBe(true);
  });
});
