import { describe, it, expect, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { bootstrapRolesSql, APP_READ_TABLES, STRATUM_FUNCTION_BODY_MD5 } from "../role-model.js";
import { migrationSql, STRATUM_CONTROL_ROLE } from "../migration-sql.js";
import * as lib from "../index.js";

describe("bootstrapRolesSql", () => {
  it("creates the default control role and grants it the schema when called without options", () => {
    const sql = bootstrapRolesSql();
    expect(sql).toContain(`CREATE ROLE "${STRATUM_CONTROL_ROLE}" NOLOGIN NOSUPERUSER NOBYPASSRLS`);
    expect(sql).toContain(`GRANT USAGE, CREATE ON SCHEMA "public" TO "${STRATUM_CONTROL_ROLE}"`);
    expect(sql).toContain(`PERFORM "public".stratum_apply_control_role('stratum_control', 'public')`);
    expect(sql).not.toMatch(/GRANT "stratum_control" TO/);
    expect(sql).not.toMatch(/GRANT SELECT/);
  });

  it("makes the admin role a member of the control role with INHERIT and SET", () => {
    const sql = bootstrapRolesSql({ adminRole: "acme_admin", controlRole: "acme_control" });
    expect(sql).toContain(`GRANT "acme_control" TO "acme_admin" WITH INHERIT TRUE, SET TRUE`);
  });

  it("limits the app role to SELECT on the read list and revokes its control membership", () => {
    const sql = bootstrapRolesSql({ appRole: "acme_app" });
    expect(sql).toContain(`REVOKE "stratum_control" FROM "acme_app"`);
    expect(sql).toContain("REVOKE ALL ON %I.%I FROM %I");
    expect(sql).toContain("GRANT SELECT ON %I.%I TO %I");
    for (const table of APP_READ_TABLES) expect(sql).toContain(`'${table}'`);
    expect(sql).not.toMatch(/ARRAY\['tenants'[^\]]*'api_keys'/);
  });

  it("moves the app role's Stratum objects to the admin role when both are given", () => {
    const sql = bootstrapRolesSql({ adminRole: "acme_admin", appRole: "acme_app" });
    expect(sql).toContain("ALTER TABLE %I.%I OWNER TO %I");
    expect(sql).toContain("ALTER FUNCTION %s OWNER TO %I");
  });

  it.each([["controlRole"], ["adminRole"], ["appRole"], ["schema"]])("rejects a %s that is not a plain identifier", (key) => {
    expect(() => bootstrapRolesSql({ [key]: `x"; DROP TABLE tenants; --` })).toThrow(/Invalid/);
  });

  it("is exported from the package entry point with the control role constant", () => {
    expect(lib.bootstrapRolesSql).toBe(bootstrapRolesSql);
    expect(lib.STRATUM_CONTROL_ROLE).toBe("stratum_control");
  });
});

/** The body of the last plain `CREATE OR REPLACE FUNCTION <name>(` in the migrations, in file order. */
function lastBody(name: string): string {
  const dir = path.resolve(__dirname, "../migrations");
  let body: string | undefined;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    for (const match of sql.matchAll(new RegExp(`CREATE OR REPLACE FUNCTION ${name}\\(`, "g"))) {
      const rest = sql.slice(match.index);
      const tag = rest.match(/\$(\w*)\$/);
      if (!tag || tag.index === undefined) continue;
      const start = tag.index + tag[0].length;
      body = rest.slice(start, rest.indexOf(tag[0], start));
    }
  }
  if (body === undefined) throw new Error(`no definition of ${name} in the migrations`);
  return body;
}

describe("the integrity check of bootstrapRolesSql", () => {
  it.each(Object.keys(STRATUM_FUNCTION_BODY_MD5))("pins the body of %s that the migrations define last", (name) => {
    expect(crypto.createHash("md5").update(lastBody(name)).digest("hex")).toBe(STRATUM_FUNCTION_BODY_MD5[name]);
  });

  it("runs before every other statement of the bootstrap SQL", () => {
    const sql = bootstrapRolesSql({ adminRole: "acme_admin", appRole: "acme_app" });
    const check = sql.indexOf("carry objects the Stratum migrations did not create");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(sql.indexOf("CREATE ROLE"));
    expect(check).toBeLessThan(sql.indexOf("stratum_apply_control_role('"));
  });
});

describe("migrationSql", () => {
  const sql029 = "CREATE FUNCTION f()\nRETURNS TRIGGER\nSET app.bypass_rls = 'on'\nAS $$ $$;\n";
  const sql031 = "CREATE FUNCTION g()\nSET app.bypass_rls = 'on'\nSET app.tenant_scope = ''\nAS $$ $$;\nSET LOCAL app.bypass_rls = 'on';\n";

  it("drops the app.* function settings of 029 and 031 for a role that is not a superuser", () => {
    expect(migrationSql("029_tenant_parent_cycle_guard.sql", sql029, false)).toBe(
      "CREATE FUNCTION f()\nRETURNS TRIGGER\nAS $$ $$;\n",
    );
    expect(migrationSql("031_subtree_read_scope.sql", sql031, false)).toBe(
      "CREATE FUNCTION g()\nAS $$ $$;\nSET LOCAL app.bypass_rls = 'on';\n",
    );
  });

  it("runs 029 and 031 unchanged for a superuser", () => {
    expect(migrationSql("029_tenant_parent_cycle_guard.sql", sql029, true)).toBe(sql029);
  });

  it("runs every other migration unchanged", () => {
    expect(migrationSql("024_propagate_ancestry_ltree.sql", sql029, false)).toBe(sql029);
  });
});

describe("warnLegacyKeyHash", () => {
  it("warns once per process however often a legacy key hash authenticates", async () => {
    vi.resetModules();
    const { warnLegacyKeyHash } = await import("../role-model.js");
    const warn = vi.fn();
    const logger = { info: vi.fn(), error: vi.fn(), warn };
    warnLegacyKeyHash(logger);
    warnLegacyKeyHash(logger);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/2\.0 will refuse such keys/);
  });
});
