import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { bootstrapRolesSql, inspectRoleModel, migrate } from "@stratum-hq/lib";
import { BASE_URL, ROLE_PREFIX, dropTestRole, scratchDatabase, urlFor } from "./helpers/role-model.js";

/**
 * The settings of the functions migration 032 creates, and what the control
 * role and its bootstrap SQL require of the schema of the Stratum tables:
 * every elevated function runs with only pg_catalog on its search path, the
 * schema grants CREATE to no one by default, and the bootstrap refuses
 * functions and operators in the schema that are not Stratum's or an
 * extension's.
 */

const DB = scratchDatabase("ctl_settings");
const CONTROL = `${ROLE_PREFIX}settings_control`;
const APP = `${ROLE_PREFIX}settings_app`;
const OPTION = `-c stratum.control_role=${CONTROL}`;
const PINNED = ["search_path=pg_catalog, pg_temp"];

let su: pg.Client;
let pool: pg.Pool;

beforeAll(async () => {
  su = new pg.Client({ connectionString: BASE_URL });
  await su.connect();
  await su.query(`DROP DATABASE IF EXISTS "${DB}"`);
  await dropTestRole(su, APP);
  await dropTestRole(su, CONTROL);
  await su.query(`CREATE ROLE "${APP}" LOGIN NOSUPERUSER NOBYPASSRLS`);
  await su.query(`CREATE DATABASE "${DB}"`);
  pool = new pg.Pool({ connectionString: urlFor({ database: DB }), max: 2, options: OPTION });
  await pool.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; CREATE EXTENSION IF NOT EXISTS ltree`);
  // As PostgreSQL 14 and earlier start: PUBLIC may create objects in public.
  await pool.query("GRANT CREATE ON SCHEMA public TO PUBLIC");
  await migrate({ pool, controlRole: CONTROL });
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await su.query(`DROP DATABASE IF EXISTS "${DB}"`);
  await dropTestRole(su, APP);
  await dropTestRole(su, CONTROL);
  await su.end();
});

describe("the functions of migration 032", () => {
  it.each([
    "stratum_legacy_bypass",
    "stratum_subtree_tenant_ids",
    "refuse_tenant_parent_cycle",
    "refuse_tenant_tree_column_change",
    "stratum_apply_control_role",
  ])("%s runs with only pg_catalog on its search path", async (name) => {
    const res = await pool.query<{ proconfig: string[] | null }>(
      "SELECT proconfig FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = $1",
      [name],
    );
    expect(res.rows).toEqual([{ proconfig: PINNED }]);
  });

  it("leave PUBLIC without CREATE on the schema once the control role is applied", async () => {
    const res = await pool.query("SELECT has_schema_privilege('public', 'public', 'CREATE') AS c");
    expect(res.rows[0].c).toBe(false);
  });
});

describe("stratum_apply_control_role()", () => {
  it("applies the control role only to the schema it is in", async () => {
    await pool.query("CREATE SCHEMA IF NOT EXISTS settings_other");
    await expect(
      pool.query("SELECT public.stratum_apply_control_role($1, 'settings_other')", [CONTROL]),
    ).rejects.toThrow(/only to the schema it is in/);
  });

  it("refuses a control role that can log in", async () => {
    await su.query(`ALTER ROLE "${CONTROL}" LOGIN`);
    try {
      await expect(pool.query("SELECT public.stratum_apply_control_role($1, 'public')", [CONTROL])).rejects.toThrow(
        /must be NOLOGIN NOSUPERUSER NOBYPASSRLS/,
      );
    } finally {
      await su.query(`ALTER ROLE "${CONTROL}" NOLOGIN`);
    }
  });
});

describe("the bootstrap SQL", () => {
  it("refuses a function named like a built-in and an operator in the schema, and runs once they are gone", async () => {
    await pool.query("CREATE FUNCTION public.lower(integer) RETURNS integer LANGUAGE sql IMMUTABLE AS 'SELECT $1'");
    await pool.query("CREATE OPERATOR public.=== (LEFTARG = integer, RIGHTARG = integer, FUNCTION = int4eq)");
    const sql = bootstrapRolesSql({ controlRole: CONTROL, appRole: APP });
    let message = "";
    try {
      await pool.query(sql);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/function public\.lower\(integer\) in the schema/);
    expect(message).toMatch(/operator public\.===\(integer,integer\) in the schema/);

    await pool.query("DROP OPERATOR public.=== (integer, integer)");
    await pool.query("DROP FUNCTION public.lower(integer)");
    await expect(pool.query(sql)).resolves.toBeDefined();
  });

  it("leaves the application login without CREATE on the schema", async () => {
    await pool.query(`GRANT CREATE ON SCHEMA public TO "${APP}"`);
    let report = await inspectRoleModel({ pool, appRole: APP, controlRole: CONTROL });
    expect(report.appIssues?.join("\n")).toMatch(/can create objects in the schema "public"/);

    await pool.query(bootstrapRolesSql({ controlRole: CONTROL, appRole: APP }));
    report = await inspectRoleModel({ pool, appRole: APP, controlRole: CONTROL });
    expect(report.appIssues).toEqual([]);
  });
});
