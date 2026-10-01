import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate, Stratum, type StratumLogger } from "@stratum-hq/lib";
import { BASE_URL, ROLE_PREFIX, dropTestRole, scratchDatabase, urlFor } from "./helpers/role-model.js";

/**
 * The role-model checks around migration 032 on an install whose owner is a
 * login with CREATEROLE but no superuser, as on many managed services:
 *
 * - the control-role opt-in counts only when the migrating session sets it;
 * - `stratum db roles --apply` runs only as a superuser or the named admin
 *   login;
 * - with adminPool and enforceRls, an application login that can create
 *   objects in the Stratum schema stops initialize(), also before the
 *   control role is applied; without adminPool it is a warning;
 * - applying the control role takes every Stratum function from its former
 *   owner;
 * - migration 032 checks the Stratum tables before it applies the control
 *   role, and warns instead of applying it when they carry foreign objects;
 * - autoMigrate refuses an adminPool that logs in as the application login.
 */

const DB = scratchDatabase("role_checks");
const OWNER = `${ROLE_PREFIX}rc_owner`;
const APP = `${ROLE_PREFIX}rc_app`;
const CONTROL = `${ROLE_PREFIX}rc_control`;
const PASSWORD = "rc_pw";
// Overrides a stratum.control_role that PGOPTIONS may set for the whole run.
const CONTROL_OPTION = `-c stratum.control_role=${CONTROL}`;
const MIGRATION_032 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../lib/src/migrations/032_control_role.sql");
const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../cli/dist/index.js");
const SUPERUSER = decodeURIComponent(new URL(BASE_URL).username);

const ownerUrl = urlFor({ user: OWNER, password: PASSWORD, database: DB });
const appUrl = urlFor({ user: APP, password: PASSWORD, database: DB });

let su: pg.Client;
let suDb: pg.Pool;

function capture(): StratumLogger & { warnings: string[] } {
  const warnings: string[] = [];
  return { warnings, info() {}, error() {}, warn: (msg: string) => warnings.push(msg) };
}

function poolFor(url: string): pg.Pool {
  return new pg.Pool({ connectionString: url, max: 2, options: CONTROL_OPTION });
}

async function withPools<T>(urls: string[], fn: (...pools: pg.Pool[]) => Promise<T>): Promise<T> {
  const pools = urls.map(poolFor);
  try {
    return await fn(...pools);
  } finally {
    await Promise.all(pools.map((p) => p.end()));
  }
}

async function isMember(role: string): Promise<boolean> {
  const res = await suDb.query(
    "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $2) AND pg_has_role($1, $2, 'MEMBER') AS m",
    [role, CONTROL],
  );
  return res.rows[0].m === true;
}

async function controlPolicies(): Promise<number> {
  const res = await suDb.query("SELECT count(*)::int AS n FROM pg_policies WHERE policyname = 'stratum_control_plane'");
  return res.rows[0].n;
}

beforeAll(async () => {
  su = new pg.Client({ connectionString: BASE_URL });
  await su.connect();
  await su.query(`DROP DATABASE IF EXISTS "${DB}"`);
  for (const role of [OWNER, APP, CONTROL]) await dropTestRole(su, role);
  await su.query(`CREATE ROLE "${OWNER}" LOGIN PASSWORD '${PASSWORD}' NOSUPERUSER NOBYPASSRLS CREATEROLE`);
  await su.query(`CREATE ROLE "${APP}" LOGIN PASSWORD '${PASSWORD}' NOSUPERUSER NOBYPASSRLS`);
  await su.query(`CREATE DATABASE "${DB}" OWNER "${OWNER}"`);
  suDb = new pg.Pool({ connectionString: urlFor({ database: DB }), max: 2, options: CONTROL_OPTION });
  await suDb.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; CREATE EXTENSION IF NOT EXISTS ltree`);
  // The owner migrates without the opt-in: the control role is not applied.
  await withPools([ownerUrl], (owner) => migrate({ pool: owner, controlRole: CONTROL }));
}, 120_000);

afterAll(async () => {
  await suDb?.end();
  await su.query(`DROP DATABASE IF EXISTS "${DB}"`);
  for (const role of [OWNER, APP, CONTROL]) await dropTestRole(su, role);
  await su.end();
});

describe("initialize() while the control role is not applied", () => {
  it("fails with adminPool and enforceRls when the application login can create objects in the Stratum schema", async () => {
    expect(await controlPolicies()).toBe(0);
    await suDb.query(`GRANT CREATE ON SCHEMA public TO "${APP}"`);
    try {
      await withPools([appUrl, ownerUrl], async (app, owner) => {
        const stratum = new Stratum({ pool: app, adminPool: owner, controlRole: CONTROL, enforceRls: true, logger: capture() });
        await expect(stratum.initialize()).rejects.toThrow(/can create objects in the schema "public"/);
      });
    } finally {
      await suDb.query(`REVOKE CREATE ON SCHEMA public FROM "${APP}"`);
    }
  });
});

describe("the control-role opt-in of migration 032", () => {
  it("does not count when it comes from a role default rather than the migrating session", async () => {
    expect(await isMember(OWNER)).toBe(false);
    await su.query(`ALTER ROLE "${OWNER}" IN DATABASE "${DB}" SET stratum.apply_control_role = 'on'`);
    try {
      await withPools([ownerUrl], (owner) => owner.query(fs.readFileSync(MIGRATION_032, "utf8")));
    } finally {
      await su.query(`ALTER ROLE "${OWNER}" IN DATABASE "${DB}" RESET stratum.apply_control_role`);
    }
    expect(await isMember(OWNER)).toBe(false);
    expect(await controlPolicies()).toBe(0);
  });
});

describe("stratum db roles --apply", () => {
  it("refuses to run as a login that is neither a superuser nor the named admin login", () => {
    const res = spawnSync(process.execPath, [CLI, "db", "roles", "--apply", "--database-url", ownerUrl, "--control-role", CONTROL], {
      encoding: "utf8",
      env: { ...process.env, PGOPTIONS: "", NODE_ENV: "test", DATABASE_ADMIN_URL: "" },
      timeout: 60000,
    });
    expect(res.status).toBe(1);
    expect(`${res.stdout}${res.stderr}`).toMatch(/not a superuser/);
    return isMember(OWNER).then((m) => expect(m).toBe(false));
  });
});

describe("stratum_apply_control_role()", () => {
  it("leaves the former owner of the Stratum objects owning none of the Stratum functions", async () => {
    await suDb.query("SELECT public.stratum_apply_control_role($1, 'public')", [CONTROL]);
    const res = await suDb.query<{ proname: string; owner: string }>(
      `SELECT p.proname::text, pg_get_userbyid(p.proowner)::text AS owner FROM pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace
          AND p.proname = ANY ($1::text[])
        ORDER BY 1`,
      [[
        "update_updated_at_column", "maintain_ancestry_ltree", "propagate_ancestry_ltree", "refuse_tenant_parent_cycle",
        "refuse_tenant_tree_column_change", "stratum_subtree_tenant_ids", "stratum_legacy_bypass", "stratum_apply_control_role",
      ]],
    );
    expect(res.rows).toHaveLength(8);
    for (const row of res.rows) expect([CONTROL, SUPERUSER], row.proname).toContain(row.owner);
    expect(res.rows.find((r) => r.proname === "refuse_tenant_tree_column_change")?.owner).toBe(CONTROL);
  });
});

describe("initialize() without adminPool", () => {
  it("warns when the application login can create objects in the Stratum schema", async () => {
    await suDb.query(`GRANT CREATE ON SCHEMA public TO "${APP}"`);
    try {
      const logger = capture();
      await withPools([appUrl], (app) => new Stratum({ pool: app, controlRole: CONTROL, logger }).initialize());
      expect(logger.warnings.join("\n")).toMatch(/the app role "[^"]+" can create objects in the schema "public"/);
    } finally {
      await suDb.query(`REVOKE CREATE ON SCHEMA public FROM "${APP}"`);
    }
  });
});

describe("migration 032 run again", () => {
  it("warns and leaves the control role unapplied when the Stratum tables carry a foreign trigger", async () => {
    await suDb.query(`
      CREATE FUNCTION public.rc_touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
      CREATE TRIGGER rc_touch BEFORE UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.rc_touch();
      DROP POLICY stratum_control_plane ON public.regions;
    `);
    const client = await suDb.connect();
    const notices: string[] = [];
    client.on("notice", (n) => notices.push(n.message ?? ""));
    try {
      await client.query(fs.readFileSync(MIGRATION_032, "utf8"));
    } finally {
      client.release();
      await suDb.query("DROP TRIGGER rc_touch ON public.tenants; DROP FUNCTION public.rc_touch()");
    }
    expect(notices.join("\n")).toMatch(/NOT active in schema "public": the Stratum tables carry objects/);
    expect(notices.join("\n")).toMatch(/trigger rc_touch on tenants calls public\.rc_touch\(\)/);
    const regions = await suDb.query(
      "SELECT count(*)::int AS n FROM pg_policies WHERE tablename = 'regions' AND policyname = 'stratum_control_plane'",
    );
    expect(regions.rows[0].n).toBe(0);

    await suDb.query("SELECT public.stratum_apply_control_role($1, 'public')", [CONTROL]);
  });
});

describe("autoMigrate with adminPool", () => {
  it("refuses an adminPool that logs in as the same role as pool", async () => {
    await withPools([ownerUrl, ownerUrl], async (pool, adminPool) => {
      const stratum = new Stratum({ pool, adminPool, controlRole: CONTROL, autoMigrate: true, logger: capture() });
      await expect(stratum.initialize()).rejects.toThrow(/adminPool and pool log in as the same role/);
    });
    expect(await isMember(OWNER)).toBe(false);
  });
});
