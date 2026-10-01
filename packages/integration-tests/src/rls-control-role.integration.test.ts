import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { bootstrapRolesSql, migrate, noopLogger, Stratum } from "@stratum-hq/lib";
import {
  APP_READ_TABLES,
  BASE_URL,
  ROLE_PREFIX,
  controlRoleName,
  dropTestRole,
  errorCode,
  inRolledBackTx,
  scratchDatabase,
  urlFor,
} from "./helpers/role-model.js";

/**
 * The control-role model of migration 032, checked as an attacker would use
 * it: SQL that runs as the application role, for example through SQL
 * injection in the consuming application.
 *
 * The application roles here are LOGIN roles that connect directly, not
 * roles a superuser switches to, so nothing in the session can leave them.
 * The database is set up the way the hardened deployment is:
 *
 * - The migrations run as another role, so the application role owns
 *   nothing. Two setups run the same checks:
 *   1. a superuser migrates, and 032 applies the control role itself;
 *   2. an upgrade: a database owner without CREATEROLE migrates, 032 skips
 *      the control role with a warning, and a superuser then runs the
 *      bootstrap SQL (bootstrapRolesSql), which applies it.
 * - The legacy app.bypass_rls switch in stratum_security is off.
 * - APP_ROLE has the recommended grants: SELECT on the read-list tables only.
 * - WIDE_ROLE has the write grants older setups gave the application role
 *   (docker/init-db.sql: ALL on every table), to show that row-level security
 *   holds without the privilege lockdown too.
 *
 * Tree: A -> A1, and B. Each tenant has its own config, permission, role,
 * usage, audit and api key rows.
 */

const MODES = [
  { key: "su", title: "migrated by a superuser" },
  { key: "upgrade", title: "upgraded by a role without CREATEROLE, then bootstrapped" },
] as const;

for (const mode of MODES) {
describe(mode.title, () => {
  const DB = scratchDatabase(`ctl_attack_${mode.key}`);
  const APP_ROLE = `${ROLE_PREFIX}attack_${mode.key}_app`;
  const WIDE_ROLE = `${ROLE_PREFIX}attack_${mode.key}_wide`;
  const OWNER_ROLE = `${ROLE_PREFIX}attack_${mode.key}_owner`;
  const PASSWORD = "attack_pw";

  let su: pg.Client;
  let suPool: pg.Pool;
  let ownerPool: pg.Pool | undefined;
  let appPool: pg.Pool;
  let widePool: pg.Pool;
  let control: string;
  const ids = { a: "", a1: "", b: "" };

  /** Runs `fn` as `pool`'s role with the bypass setting on and tenant `tenant` in context. */
  function withBypassAndTenant<T>(
    pool: pg.Pool,
    tenant: string | null,
    fn: (c: pg.PoolClient) => Promise<T>,
    scope = "",
  ): Promise<T> {
    return inRolledBackTx(pool, async (c) => {
      await c.query("SET LOCAL app.bypass_rls = 'on'");
      await c.query(
        "SELECT set_config('app.current_tenant_id', $1, true), set_config('app.tenant_scope', $2, true)",
        [tenant ?? "", scope],
      );
      return fn(c);
    });
  }

  async function setLegacySwitch(on: boolean): Promise<void> {
    const present = await suPool.query("SELECT to_regclass('stratum_security') IS NOT NULL AS present");
    if (present.rows[0].present) {
      await suPool.query("UPDATE stratum_security SET legacy_guc_bypass = $1", [on]);
    }
  }

  async function countAsSuperuser(table: string, tenant: string): Promise<number> {
    const res = await suPool.query(
      table === "tenants"
        ? `SELECT count(*)::int AS n FROM tenants WHERE id = $1`
        : table === "webhook_deliveries"
          ? `SELECT count(*)::int AS n FROM webhook_deliveries d JOIN webhook_events e ON e.id = d.event_id WHERE e.tenant_id = $1`
          : table === "principal_roles"
            ? `SELECT count(*)::int AS n FROM principal_roles p JOIN roles r ON r.id = p.role_id WHERE r.tenant_id = $1`
            : `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`,
      [tenant],
    );
    return res.rows[0].n;
  }

  beforeAll(async () => {
    su = new pg.Client({ connectionString: BASE_URL });
    await su.connect();
    await su.query(`DROP DATABASE IF EXISTS "${DB}"`);
    for (const role of [APP_ROLE, WIDE_ROLE, OWNER_ROLE]) {
      await dropTestRole(su, role);
      await su.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${PASSWORD}' NOSUPERUSER NOBYPASSRLS`);
    }
    await su.query(`CREATE DATABASE "${DB}"${mode.key === "upgrade" ? ` OWNER "${OWNER_ROLE}"` : ""}`);

    suPool = new pg.Pool({ connectionString: urlFor({ database: DB }), max: 3 });
    control = await controlRoleName(suPool);
    let stratum: Stratum;
    if (mode.key === "upgrade") {
      ownerPool = new pg.Pool({ connectionString: urlFor({ user: OWNER_ROLE, password: PASSWORD, database: DB }), max: 2 });
      await migrate({ pool: ownerPool });
      const applied = await suPool.query("SELECT 1 FROM pg_policies WHERE policyname = 'stratum_control_plane'");
      expect(applied.rows).toEqual([]);
      await suPool.query(bootstrapRolesSql({ adminRole: OWNER_ROLE, controlRole: control }));
      // Seeded through the library on the owner, now a member of the control role.
      stratum = new Stratum({ adminPool: ownerPool, pool: ownerPool, logger: noopLogger });
    } else {
      await migrate({ pool: suPool });
      // Seeded by the superuser through the library.
      stratum = new Stratum({ pool: suPool, logger: noopLogger });
    }
    const audit = { actor_id: "attack-setup", actor_type: "system" as const };
    ids.a = (await stratum.createTenant({ name: "A", slug: "atk_a" }, audit)).id;
    ids.a1 = (await stratum.createTenant({ name: "A1", slug: "atk_a1", parent_id: ids.a }, audit)).id;
    ids.b = (await stratum.createTenant({ name: "B", slug: "atk_b" }, audit)).id;
    for (const [label, id] of Object.entries(ids)) {
      await stratum.setConfig(id, `cfg_${label}`, { value: label });
      await stratum.createPermission(id, { key: `perm_${label}`, value: true });
      const role = await stratum.createRole({ name: `role_${label}`, scopes: ["read"], tenant_id: id });
      await stratum.assignRole("user", `user_${label}`, role.id, id);
      await stratum.recordUsage(id, { metric: "calls", quantity: 1 });
      await stratum.grantConsent(id, { subject_id: `subj_${label}`, purpose: "analytics" });
      await stratum.createApiKey(id, `key_${label}`);
      await stratum.createAbacPolicy(id, {
        name: `abac_${label}`,
        resource_type: "doc",
        action: "read",
        effect: "allow",
        conditions: [],
      });
    }
    await stratum.createRegion({ display_name: "Attack region", slug: "atk_region" });

    await suPool.query(`GRANT USAGE ON SCHEMA public TO "${APP_ROLE}", "${WIDE_ROLE}"`);
    await suPool.query(`GRANT SELECT ON ${APP_READ_TABLES.join(", ")} TO "${APP_ROLE}"`);
    await suPool.query(`GRANT ALL ON ALL TABLES IN SCHEMA public TO "${WIDE_ROLE}"`);
    await setLegacySwitch(false);

    appPool = new pg.Pool({ connectionString: urlFor({ user: APP_ROLE, password: PASSWORD, database: DB }), max: 2 });
    widePool = new pg.Pool({ connectionString: urlFor({ user: WIDE_ROLE, password: PASSWORD, database: DB }), max: 2 });
  }, 60_000);

  afterAll(async () => {
    await appPool?.end();
    await widePool?.end();
    await ownerPool?.end();
    await suPool?.end();
    await su.query(`DROP DATABASE IF EXISTS "${DB}"`);
    for (const role of [APP_ROLE, WIDE_ROLE, OWNER_ROLE]) await dropTestRole(su, role);
    await su.end();
  });

  describe("the application role with the recommended grants, legacy bypass off", () => {
    it("logs in as itself, not as a superuser or a member of the control role", async () => {
      const res = await appPool.query(
        `SELECT current_user AS me, r.rolsuper, r.rolbypassrls,
                EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1 AND pg_has_role(current_user, oid, 'MEMBER')) AS member
           FROM pg_roles r WHERE r.rolname = current_user`,
        [control],
      );
      expect(res.rows[0]).toEqual({ me: APP_ROLE, rolsuper: false, rolbypassrls: false, member: false });
    });

    it("reads only tenant A's rows on every read-list table with app.bypass_rls on and tenant A in context", async () => {
      for (const table of APP_READ_TABLES) {
        const total = await suPool.query(`SELECT count(*)::int AS n FROM ${table}`);
        const own = await countAsSuperuser(table, ids.a);
        const seen = await withBypassAndTenant(appPool, ids.a, (c) =>
          c.query(`SELECT count(*)::int AS n FROM ${table}`),
        );
        expect({ table, n: seen.rows[0].n }).toEqual({ table, n: own });
        if (table !== "webhook_events" && table !== "webhook_deliveries") {
          // The seed gives every other table rows of B too, so this check can fail.
          expect({ table, othersExist: total.rows[0].n > own }).toEqual({ table, othersExist: true });
        }
      }
      const tenants = await withBypassAndTenant(appPool, ids.a, (c) => c.query("SELECT id FROM tenants"));
      expect(tenants.rows.map((r) => r.id)).toEqual([ids.a]);
    });

    it("reads 0 rows on every read-list table with app.bypass_rls on and no tenant context", async () => {
      for (const table of APP_READ_TABLES) {
        const seen = await withBypassAndTenant(appPool, null, (c) =>
          c.query(`SELECT count(*)::int AS n FROM ${table}`),
        );
        expect({ table, n: seen.rows[0].n }).toEqual({ table, n: 0 });
      }
    });

    it("is denied SELECT on api_keys, webhooks, regions and stratum_security", async () => {
      for (const table of ["api_keys", "webhooks", "regions", "stratum_security"]) {
        const code = await errorCode(() =>
          withBypassAndTenant(appPool, ids.a, (c) => c.query(`SELECT * FROM ${table}`)),
        );
        expect({ table, code }).toEqual({ table, code: "42501" });
      }
    });

    it("is denied INSERT into api_keys and tenants", async () => {
      expect(
        await errorCode(() =>
          withBypassAndTenant(appPool, ids.a, (c) =>
            c.query(
              `INSERT INTO api_keys (tenant_id, key_hash, key_prefix, name) VALUES (NULL, repeat('a', 64), 'sk_', 'x')`,
            ),
          ),
        ),
      ).toBe("42501");
      expect(
        await errorCode(() =>
          withBypassAndTenant(appPool, ids.a, (c) =>
            c.query(`INSERT INTO tenants (name, slug, ancestry_path) VALUES ('x', 'atk_x', '/')`),
          ),
        ),
      ).toBe("42501");
    });

    it("is denied moving tenant A under tenant B", async () => {
      const code = await errorCode(() =>
        withBypassAndTenant(appPool, ids.a, (c) =>
          c.query("UPDATE tenants SET parent_id = $1 WHERE id = $2", [ids.b, ids.a]),
        ),
      );
      expect(code).toBe("42501");
    });

    it("is denied SET ROLE to the control role", async () => {
      const code = await errorCode(() => inRolledBackTx(appPool, (c) => c.query(`SET ROLE "${control}"`)));
      expect(code).toBe("42501");
    });

    it("is denied turning row-level security off, replacing a Stratum helper, or turning the legacy switch on", async () => {
      const attempts = [
        "ALTER TABLE tenants DISABLE ROW LEVEL SECURITY",
        "ALTER TABLE api_keys NO FORCE ROW LEVEL SECURITY",
        "DROP POLICY tenant_isolation ON tenants",
        `CREATE OR REPLACE FUNCTION stratum_subtree_tenant_ids() RETURNS uuid[] LANGUAGE sql AS $$ SELECT array_agg(id) FROM tenants $$`,
        `CREATE OR REPLACE FUNCTION stratum_legacy_bypass() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$`,
        "UPDATE stratum_security SET legacy_guc_bypass = true",
      ];
      for (const sql of attempts) {
        const code = await errorCode(() => inRolledBackTx(appPool, (c) => c.query(sql)));
        expect({ sql, code }).toEqual({ sql, code: "42501" });
      }
    });

    it("reads tenant A's subtree, and only that subtree, in subtree scope even with app.bypass_rls on", async () => {
      const res = await withBypassAndTenant(
        appPool,
        ids.a,
        (c) => c.query("SELECT id FROM tenants"),
        "subtree",
      );
      expect(res.rows.map((r) => r.id).sort()).toEqual([ids.a, ids.a1].sort());
      const cfg = await withBypassAndTenant(
        appPool,
        ids.a,
        (c) => c.query("SELECT key FROM config_entries ORDER BY key"),
        "subtree",
      );
      expect(cfg.rows.map((r) => r.key)).toEqual(["cfg_a", "cfg_a1"]);
    });

    it("gets the subtree from stratum_subtree_tenant_ids() in subtree scope without recursing", async () => {
      const res = await withBypassAndTenant(
        appPool,
        ids.a,
        (c) => c.query<{ ids: string[] }>("SELECT stratum_subtree_tenant_ids() AS ids"),
        "subtree",
      );
      expect([...res.rows[0].ids].sort()).toEqual([ids.a, ids.a1].sort());
    });
  });

  describe("an application role that keeps the legacy write grants, legacy bypass off", () => {
    it("cannot insert a global api key with app.bypass_rls on", async () => {
      const code = await errorCode(() =>
        withBypassAndTenant(widePool, ids.a, (c) =>
          c.query(
            `INSERT INTO api_keys (tenant_id, key_hash, key_prefix, name) VALUES (NULL, repeat('b', 64), 'sk_', 'minted')`,
          ),
        ),
      );
      expect(code).toBe("42501");
    });

    it("reads only tenant A's api keys with app.bypass_rls on", async () => {
      const res = await withBypassAndTenant(widePool, ids.a, (c) => c.query("SELECT tenant_id FROM api_keys"));
      expect(res.rows.map((r) => r.tenant_id)).toEqual([ids.a]);
    });

    it("cannot move tenant A under tenant B with app.bypass_rls on", async () => {
      const code = await errorCode(() =>
        withBypassAndTenant(widePool, ids.a, (c) =>
          c.query("UPDATE tenants SET parent_id = $1 WHERE id = $2", [ids.b, ids.a]),
        ),
      );
      expect(code).toBe("42501");
    });

    it("cannot read or write regions", async () => {
      const read = await withBypassAndTenant(widePool, ids.a, (c) => c.query("SELECT id FROM regions"));
      expect(read.rows).toEqual([]);
      const code = await errorCode(() =>
        withBypassAndTenant(widePool, ids.a, (c) =>
          c.query(`INSERT INTO regions (display_name, slug) VALUES ('Evil', 'atk_evil')`),
        ),
      );
      expect(code).toBe("42501");
    });

    it("cannot turn the legacy switch back on", async () => {
      const res = await withBypassAndTenant(widePool, ids.a, (c) =>
        c.query("UPDATE stratum_security SET legacy_guc_bypass = true"),
      );
      expect(res.rowCount).toBe(0);
      const after = await suPool.query("SELECT legacy_guc_bypass FROM stratum_security");
      expect(after.rows).toEqual([{ legacy_guc_bypass: false }]);
    });
  });

  describe("the legacy bypass switch", () => {
    it("keeps the 1.8 behavior while on: app.bypass_rls opens every tenant's rows to the application role", async () => {
      await setLegacySwitch(true);
      try {
        const res = await withBypassAndTenant(appPool, null, (c) => c.query("SELECT id FROM tenants"));
        expect(res.rows.map((r) => r.id).sort()).toEqual([ids.a, ids.a1, ids.b].sort());
        const regions = await withBypassAndTenant(widePool, null, (c) => c.query("SELECT slug FROM regions"));
        expect(regions.rows).toEqual([{ slug: "atk_region" }]);
      } finally {
        await setLegacySwitch(false);
      }
    });

    it("closes app.bypass_rls once off", async () => {
      const res = await withBypassAndTenant(appPool, null, (c) => c.query("SELECT id FROM tenants"));
      expect(res.rows).toEqual([]);
    });
  });

  describe("the catalog after migration 032", () => {
    const STRATUM_RLS_TABLES = [...APP_READ_TABLES, "api_keys", "webhooks", "regions", "stratum_security"];

    it("enables and forces row-level security on every Stratum table", async () => {
      const res = await suPool.query<{ relname: string; on: boolean; forced: boolean }>(
        `SELECT relname, relrowsecurity AS on, relforcerowsecurity AS forced
           FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname = ANY($1)`,
        [STRATUM_RLS_TABLES],
      );
      expect(res.rows.map((r) => r.relname).sort()).toEqual([...STRATUM_RLS_TABLES].sort());
      for (const row of res.rows) expect(row).toMatchObject({ on: true, forced: true });
    });

    it("gives every Stratum table a control-plane policy for exactly the control role", async () => {
      const res = await suPool.query<{ tablename: string; roles: string[]; cmd: string; qual: string; with_check: string; permissive: string }>(
        `SELECT tablename, roles::text[] AS roles, cmd, qual, with_check, permissive
           FROM pg_policies WHERE schemaname = 'public' AND policyname = 'stratum_control_plane'`,
      );
      expect(res.rows.map((r) => r.tablename).sort()).toEqual([...STRATUM_RLS_TABLES].sort());
      for (const row of res.rows) {
        expect(row).toMatchObject({ roles: [control], cmd: "ALL", qual: "true", with_check: "true", permissive: "PERMISSIVE" });
      }
    });

    it("admits app.bypass_rls in no policy except through stratum_legacy_bypass()", async () => {
      const res = await suPool.query<{ tablename: string; policyname: string; qual: string | null; with_check: string | null }>(
        `SELECT tablename, policyname, qual, with_check FROM pg_policies
          WHERE schemaname = 'public' AND tablename = ANY($1)`,
        [STRATUM_RLS_TABLES],
      );
      const names = new Set<string>();
      for (const p of res.rows) {
        names.add(p.policyname);
        for (const expr of [p.qual, p.with_check]) {
          expect({ policy: `${p.tablename}.${p.policyname}`, direct: /app\.bypass_rls/.test(expr ?? "") }).toEqual({
            policy: `${p.tablename}.${p.policyname}`,
            direct: false,
          });
        }
        if (p.policyname === "tenant_isolation") {
          expect(p.qual).toMatch(/^\(\( SELECT stratum_legacy_bypass\(\) AS stratum_legacy_bypass\) OR /);
        }
      }
      expect([...names].sort()).toEqual(
        ["stratum_control_plane", "stratum_legacy_bypass", "tenant_isolation", "tenant_subtree_read"].sort(),
      );
    });

    it("owns every SECURITY DEFINER helper by the control role and sets no app.* setting in any Stratum function", async () => {
      const res = await suPool.query<{ proname: string; definer: boolean; owner: string; config: string[] | null }>(
        `SELECT p.proname, p.prosecdef AS definer, pg_get_userbyid(p.proowner) AS owner, p.proconfig AS config
           FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
            AND p.proname IN ('stratum_subtree_tenant_ids', 'stratum_legacy_bypass',
                              'refuse_tenant_parent_cycle', 'refuse_tenant_tree_column_change')`,
      );
      const byName = Object.fromEntries(res.rows.map((r) => [r.proname, r]));
      for (const name of ["stratum_subtree_tenant_ids", "stratum_legacy_bypass", "refuse_tenant_parent_cycle"]) {
        expect(byName[name]).toMatchObject({ definer: true, owner: control });
      }
      expect(byName.refuse_tenant_tree_column_change).toMatchObject({ definer: false });
      for (const row of res.rows) {
        expect({ fn: row.proname, app: (row.config ?? []).filter((c) => c.startsWith("app.")) }).toEqual({
          fn: row.proname,
          app: [],
        });
      }
    });

    it("grants PUBLIC nothing on the Stratum tables", async () => {
      const res = await suPool.query(
        `SELECT c.relname, a.privilege_type
           FROM pg_class c, aclexplode(c.relacl) a
          WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY($1) AND a.grantee = 0`,
        [STRATUM_RLS_TABLES],
      );
      expect(res.rows).toEqual([]);
    });
  });
});
}
