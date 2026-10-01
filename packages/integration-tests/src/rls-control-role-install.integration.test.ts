import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { migrate, Stratum, bootstrapRolesSql, type StratumLogger } from "@stratum-hq/lib";
import {
  BASE_URL,
  ROLE_PREFIX,
  controlRoleName,
  dropTestRole,
  inRolledBackTx,
  scratchDatabase,
  urlFor,
} from "./helpers/role-model.js";

/**
 * A fresh install of the control-role model (migration 032) without a
 * superuser: the migrating role has CREATEROLE and owns the database, and
 * nothing else. The library then runs with adminPool on that role and pool on
 * an application role, with the legacy app.bypass_rls switch off, so every
 * library call goes through the control role alone.
 */

const INSTALL_DB = scratchDatabase("ctl_install");
const NOPRIV_DB = scratchDatabase("ctl_nopriv");
const MIGRATOR = `${ROLE_PREFIX}install_migrator`;
const APP = `${ROLE_PREFIX}install_app`;
const OWNER = `${ROLE_PREFIX}install_owner`;
// Its own control role, which the migrator creates. A role that already
// exists could only be granted to the migrator by a role with ADMIN on it.
const INSTALL_CONTROL = `${ROLE_PREFIX}install_control`;
const PASSWORD = "install_pw";

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../lib/src/migrations");
const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../cli/dist/index.js");

/** The `stratum doctor` line about the control role, for the database at `url`. */
function doctorControlRoleLine(url: string): string {
  const res = spawnSync(process.execPath, [CLI, "doctor", "--database-url", url], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    timeout: 30000,
  });
  // eslint-disable-next-line no-control-regex
  const out = `${res.stdout}${res.stderr}`.replace(/\x1b\[[0-9;]*m/g, "");
  return out.split("\n").find((l) => l.includes("Control role")) ?? out;
}

let su: pg.Client;
let adminPool: pg.Pool;
let appPool: pg.Pool;
let control: string;

function capture(): StratumLogger & { warnings: string[] } {
  const warnings: string[] = [];
  return { warnings, info() {}, error() {}, warn: (msg: string) => warnings.push(msg) };
}

beforeAll(async () => {
  su = new pg.Client({ connectionString: BASE_URL });
  await su.connect();
  control = await controlRoleName(su);
  for (const db of [INSTALL_DB, NOPRIV_DB]) await su.query(`DROP DATABASE IF EXISTS "${db}"`);
  for (const role of [MIGRATOR, APP, OWNER, INSTALL_CONTROL]) await dropTestRole(su, role);
  await su.query(`CREATE ROLE "${MIGRATOR}" LOGIN PASSWORD '${PASSWORD}' NOSUPERUSER NOBYPASSRLS CREATEROLE`);
  await su.query(`CREATE ROLE "${APP}" LOGIN PASSWORD '${PASSWORD}' NOSUPERUSER NOBYPASSRLS`);
  await su.query(`CREATE ROLE "${OWNER}" LOGIN PASSWORD '${PASSWORD}' NOSUPERUSER NOBYPASSRLS`);
  await su.query(`CREATE DATABASE "${INSTALL_DB}" OWNER "${MIGRATOR}"`);
  await su.query(`CREATE DATABASE "${NOPRIV_DB}" OWNER "${OWNER}"`);
  adminPool = new pg.Pool({ connectionString: urlFor({ user: MIGRATOR, password: PASSWORD, database: INSTALL_DB }), max: 3 });
  appPool = new pg.Pool({ connectionString: urlFor({ user: APP, password: PASSWORD, database: INSTALL_DB }), max: 3 });
}, 60_000);

afterAll(async () => {
  await adminPool?.end();
  await appPool?.end();
  for (const db of [INSTALL_DB, NOPRIV_DB]) await su.query(`DROP DATABASE IF EXISTS "${db}"`);
  for (const role of [MIGRATOR, APP, OWNER, INSTALL_CONTROL]) await dropTestRole(su, role);
  await su.end();
});

describe("a fresh install by a CREATEROLE role that is not a superuser", () => {
  it("applies every migration through autoMigrate on adminPool, creating and joining the control role", async () => {
    const stratum = new Stratum({
      adminPool,
      pool: appPool,
      autoMigrate: true,
      controlRole: INSTALL_CONTROL,
      logger: capture(),
    });
    await stratum.initialize();

    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
    const applied = await adminPool.query<{ name: string }>("SELECT name FROM _migrations ORDER BY name");
    expect(applied.rows.map((r) => r.name)).toEqual(files);

    const me = await adminPool.query(
      `SELECT r.rolsuper, pg_has_role(current_user, $1, 'USAGE') AS usage FROM pg_roles r WHERE r.rolname = current_user`,
      [INSTALL_CONTROL],
    );
    expect(me.rows[0]).toEqual({ rolsuper: false, usage: true });
  });

  it("limits the application role with the bootstrap SQL and turns the legacy switch off", async () => {
    await adminPool.query(bootstrapRolesSql({ adminRole: MIGRATOR, appRole: APP, controlRole: INSTALL_CONTROL }));
    await adminPool.query("UPDATE stratum_security SET legacy_guc_bypass = false");
    const res = await adminPool.query("SELECT legacy_guc_bypass FROM stratum_security");
    expect(res.rows).toEqual([{ legacy_guc_bypass: false }]);
  });

  it("passes the strict role-model check of initialize() with enforceRls, finding the control role in the catalog", async () => {
    const logger = capture();
    const stratum = new Stratum({ adminPool, pool: appPool, enforceRls: true, logger });
    await expect(stratum.initialize()).resolves.toBeUndefined();
    expect(logger.warnings).toEqual([]);
  });

  it("runs tree, config, key, region and subtree operations through the control role alone", async () => {
    const stratum = new Stratum({ adminPool, pool: appPool, logger: capture() });
    const root = await stratum.createTenant({ name: "Root", slug: "inst_root" });
    const left = await stratum.createTenant({ name: "Left", slug: "inst_left", parent_id: root.id });
    const right = await stratum.createTenant({ name: "Right", slug: "inst_right", parent_id: root.id });
    const leaf = await stratum.createTenant({ name: "Leaf", slug: "inst_leaf", parent_id: left.id });

    await stratum.moveTenant(leaf.id, right.id);
    expect((await stratum.getAncestors(leaf.id)).map((t) => t.id)).toEqual([root.id, right.id]);
    await expect(stratum.moveTenant(root.id, leaf.id)).rejects.toThrow();

    await stratum.setConfig(root.id, "plan", { value: "gold", locked: true });
    expect((await stratum.resolveConfig(leaf.id)).plan).toMatchObject({ value: "gold", inherited: true });

    const key = await stratum.createApiKey(leaf.id, "install");
    expect((await stratum.validateApiKey(key.plaintext_key))?.tenant_id).toBe(leaf.id);

    await stratum.createRegion({ display_name: "Install region", slug: "inst_region" });
    expect((await stratum.listRegions()).map((r) => r.slug)).toContain("inst_region");

    // The application role sees the subtree in subtree scope, and nothing else.
    const sub = await inRolledBackTx(appPool, async (c) => {
      await c.query(
        "SELECT set_config('app.current_tenant_id', $1, true), set_config('app.tenant_scope', 'subtree', true)",
        [right.id],
      );
      return c.query<{ id: string }>("SELECT id FROM tenants");
    });
    expect(sub.rows.map((r) => r.id).sort()).toEqual([right.id, leaf.id].sort());
  });

  it("reads a deep subtree in subtree scope without recursion", async () => {
    const stratum = new Stratum({ adminPool, pool: appPool, logger: capture() });
    const top = await stratum.createTenant({ name: "Deep 0", slug: "inst_deep_0" });
    let parent = top.id;
    const chain = [top.id];
    for (let i = 1; i <= 40; i++) {
      parent = (await stratum.createTenant({ name: `Deep ${i}`, slug: `inst_deep_${i}`, parent_id: parent })).id;
      chain.push(parent);
    }
    const res = await inRolledBackTx(appPool, async (c) => {
      await c.query(
        "SELECT set_config('app.current_tenant_id', $1, true), set_config('app.tenant_scope', 'subtree', true)",
        [top.id],
      );
      return c.query<{ id: string }>("SELECT id FROM tenants");
    });
    expect(res.rows.map((r) => r.id).sort()).toEqual([...chain].sort());
  }, 60_000);

  it("refuses to start in strict mode when the application role can write a Stratum table", async () => {
    await adminPool.query(`GRANT INSERT ON api_keys TO "${APP}"`);
    try {
      const stratum = new Stratum({ adminPool, pool: appPool, enforceRls: true, logger: capture() });
      await expect(stratum.initialize()).rejects.toThrow(/can write Stratum tables: api_keys/);
      const lenient = capture();
      await new Stratum({ adminPool, pool: appPool, logger: lenient }).initialize();
      expect(lenient.warnings.join("\n")).toMatch(/can read credential tables: api_keys|can write Stratum tables: api_keys/);
    } finally {
      await adminPool.query(`REVOKE INSERT ON api_keys FROM "${APP}"`);
    }
  });
});

describe("an upgrade by a migrating role without CREATEROLE and outside the control role", () => {
  let ownerPool: pg.Pool;
  const notices: string[] = [];

  beforeAll(() => {
    ownerPool = new pg.Pool({ connectionString: urlFor({ user: OWNER, password: PASSWORD, database: NOPRIV_DB }), max: 2 });
    ownerPool.on("connect", (c) => c.on("notice", (n) => notices.push(n.message ?? "")));
  });

  afterAll(async () => {
    await ownerPool.end();
  });

  it("completes migration 032 with a warning that prints the bootstrap SQL", async () => {
    // The owner is the admin login here, so it migrates with the control-role
    // opt-in; it cannot create the role.
    await migrate({ pool: ownerPool, applyControlRole: true });
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
    const applied = await ownerPool.query<{ name: string }>("SELECT name FROM _migrations ORDER BY name");
    expect(applied.rows.map((r) => r.name)).toEqual(files);

    const warning = notices.find((n) => /hardening is NOT active/.test(n));
    expect(warning).toContain(`GRANT ${control} TO ${OWNER}`);
    expect(warning).toContain(`SELECT public.stratum_apply_control_role('${control}', 'public')`);
    const policies = await ownerPool.query("SELECT 1 FROM pg_policies WHERE policyname = 'stratum_control_plane'");
    expect(policies.rows).toEqual([]);
  });

  it("keeps the pre-1.8 behavior and reports the hardening as not active", async () => {
    const logger = capture();
    const stratum = new Stratum({ pool: ownerPool, logger });
    await stratum.initialize();
    expect(logger.warnings.join("\n")).toMatch(/hardening is not active/);
    expect(doctorControlRoleLine(urlFor({ user: OWNER, password: PASSWORD, database: NOPRIV_DB }))).toMatch(
      /Hardening not active/,
    );

    const root = await stratum.createTenant({ name: "Up root", slug: "up_root" });
    const a = await stratum.createTenant({ name: "Up A", slug: "up_a", parent_id: root.id });
    const b = await stratum.createTenant({ name: "Up B", slug: "up_b", parent_id: root.id });
    await stratum.moveTenant(b.id, a.id);
    expect((await stratum.getAncestors(b.id)).map((t) => t.id)).toEqual([root.id, a.id]);
    await expect(stratum.moveTenant(root.id, b.id)).rejects.toThrow();
    await stratum.setConfig(root.id, "plan", { value: "gold" });
    expect((await stratum.resolveConfig(b.id)).plan).toMatchObject({ value: "gold", inherited: true });
    const key = await stratum.createApiKey(b.id, "up");
    expect((await stratum.validateApiKey(key.plaintext_key))?.tenant_id).toBe(b.id);
    await stratum.createRegion({ display_name: "Up region", slug: "up_region" });
    expect((await stratum.listRegions()).map((r) => r.slug)).toContain("up_region");
  });

  it("activates the hardening once a superuser runs the bootstrap SQL", async () => {
    const dbSu = new pg.Client({ connectionString: urlFor({ database: NOPRIV_DB }) });
    await dbSu.connect();
    try {
      await dbSu.query(bootstrapRolesSql({ adminRole: OWNER, controlRole: control }));
    } finally {
      await dbSu.end();
    }
    const policies = await ownerPool.query<{ roles: string[] }>(
      "SELECT DISTINCT roles::text[] AS roles FROM pg_policies WHERE policyname = 'stratum_control_plane'",
    );
    expect(policies.rows).toEqual([{ roles: [control] }]);
    const owners = await ownerPool.query<{ owner: string }>(
      `SELECT DISTINCT pg_get_userbyid(proowner) AS owner FROM pg_proc
        WHERE proname IN ('stratum_subtree_tenant_ids', 'stratum_legacy_bypass', 'refuse_tenant_parent_cycle')`,
    );
    expect(owners.rows).toEqual([{ owner: control }]);

    // The owner is now a member of the control role: the library runs on it
    // as adminPool with the legacy switch off.
    await ownerPool.query("UPDATE stratum_security SET legacy_guc_bypass = false");
    const logger = capture();
    const stratum = new Stratum({ adminPool: ownerPool, pool: ownerPool, logger });
    await stratum.initialize();
    expect(logger.warnings.join("\n")).not.toMatch(/hardening is not active/);
    expect(doctorControlRoleLine(urlFor({ user: OWNER, password: PASSWORD, database: NOPRIV_DB }))).toMatch(
      /Hardening active \(control role /,
    );
    const c = await stratum.createTenant({ name: "Up C", slug: "up_c" });
    const up = await stratum.getTenantBySlug("up_b");
    await stratum.moveTenant(up.id, c.id);
    expect((await stratum.getAncestors(up.id)).map((t) => t.id)).toEqual([c.id]);
  });
});
