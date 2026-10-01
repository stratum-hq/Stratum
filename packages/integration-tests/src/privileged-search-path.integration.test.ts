import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { inspectRoleModel, migrate, migrateAllSchemas, noopLogger, Stratum, stratumPolicyDrift } from "@stratum-hq/lib";
import { createPolicy, isRLSEnabled, listTenantSchemas } from "@stratum-hq/db-adapters";
import { BASE_URL, ROLE_PREFIX, controlRoleName, dropTestRole, scratchDatabase, urlFor } from "./helpers/role-model.js";

/**
 * Queries that Stratum runs as a privileged login (a superuser, the admin
 * login of adminPool, or the migrating login) must not resolve a function or
 * operator that another role put in a schema on the search path.
 *
 * A login with CREATE on public adds functions and operators to public with
 * the exact argument types of calls Stratum makes, so that PostgreSQL would
 * prefer them to the polymorphic or implicitly cast built-ins. Each one
 * records current_user in a table when it runs. Every privileged path then
 * runs once, and the table must stay empty.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, "../../cli/dist/index.js");
const MIGRATION_032 = path.resolve(__dirname, "../../lib/src/migrations/032_control_role.sql");

const DB = scratchDatabase("search_path");
const PLANTER = `${ROLE_PREFIX}sp_planter`;
const APP = `${ROLE_PREFIX}sp_app`;
const ADMIN = `${ROLE_PREFIX}sp_admin`;
const PASSWORD = "sp_pw";
const SUPERUSER = decodeURIComponent(new URL(BASE_URL).username);

const suUrl = urlFor({ database: DB });
const appUrl = urlFor({ user: APP, password: PASSWORD, database: DB });
const adminUrl = urlFor({ user: ADMIN, password: PASSWORD, database: DB });
const planterUrl = urlFor({ user: PLANTER, password: PASSWORD, database: DB });

let su: pg.Client;
let suPool: pg.Pool;
let control: string;

/** Functions and operators with the exact types of calls that otherwise resolve to a built-in. */
const PLANTED = `
CREATE FUNCTION public.sp_record(fn text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  INSERT INTO public.sp_hits (who, fn) VALUES (current_user, fn);
  -- A sequence keeps the count when the caller's transaction rolls back.
  PERFORM pg_catalog.nextval(pg_catalog.format('public.%I', 'sp_hit ' OPERATOR(pg_catalog.||) fn)::regclass);
END $$;

CREATE FUNCTION public.sp_oid_eq_class(oid, regclass) RETURNS boolean LANGUAGE plpgsql AS
  $$ BEGIN PERFORM public.sp_record('=(oid,regclass)'); RETURN $1 OPERATOR(pg_catalog.=) $2::oid; END $$;
CREATE OPERATOR public.= (LEFTARG = oid, RIGHTARG = regclass, FUNCTION = public.sp_oid_eq_class);

CREATE FUNCTION public.sp_oid_eq_ns(oid, regnamespace) RETURNS boolean LANGUAGE plpgsql AS
  $$ BEGIN PERFORM public.sp_record('=(oid,regnamespace)'); RETURN $1 OPERATOR(pg_catalog.=) $2::oid; END $$;
CREATE OPERATOR public.= (LEFTARG = oid, RIGHTARG = regnamespace, FUNCTION = public.sp_oid_eq_ns);

CREATE FUNCTION public.unnest(name[]) RETURNS SETOF name LANGUAGE plpgsql AS
  $$ BEGIN PERFORM public.sp_record('unnest(name[])'); RETURN QUERY SELECT pg_catalog.unnest($1); END $$;

CREATE FUNCTION public.unnest(uuid[]) RETURNS SETOF uuid LANGUAGE plpgsql AS
  $$ BEGIN PERFORM public.sp_record('unnest(uuid[])'); RETURN QUERY SELECT pg_catalog.unnest($1); END $$;

CREATE FUNCTION public.sp_text_acc(text[], text) RETURNS text[] LANGUAGE plpgsql AS
  $$ BEGIN PERFORM public.sp_record('array_agg(text)'); RETURN $1 OPERATOR(pg_catalog.||) $2; END $$;
CREATE AGGREGATE public.array_agg(text) (SFUNC = public.sp_text_acc, STYPE = text[]);

CREATE FUNCTION public.sp_json_acc(json[], json) RETURNS json[] LANGUAGE plpgsql AS
  $$ BEGIN PERFORM public.sp_record('json_agg(json)'); RETURN $1 OPERATOR(pg_catalog.||) $2; END $$;
CREATE FUNCTION public.sp_json_final(json[]) RETURNS json LANGUAGE sql AS $$ SELECT pg_catalog.array_to_json($1) $$;
CREATE AGGREGATE public.json_agg(json) (SFUNC = public.sp_json_acc, STYPE = json[], FINALFUNC = public.sp_json_final);

CREATE FUNCTION public.json_build_object(text, uuid, text, text) RETURNS json LANGUAGE plpgsql AS
  $$ BEGIN PERFORM public.sp_record('json_build_object(text,uuid,text,text)');
     RETURN pg_catalog.json_build_object($1, $2, $3, $4); END $$;

CREATE FUNCTION public.json_build_object(text, name, text, text, text, text, text, text, text, text, text, name[])
  RETURNS json LANGUAGE plpgsql AS
  $$ BEGIN PERFORM public.sp_record('json_build_object(policy row)');
     RETURN pg_catalog.json_build_object($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12); END $$;

CREATE FUNCTION public.sp_uuid_cat(uuid[], uuid) RETURNS uuid[] LANGUAGE plpgsql AS
  $$ BEGIN PERFORM public.sp_record('||(uuid[],uuid)'); RETURN pg_catalog.array_append($1, $2); END $$;
CREATE OPERATOR public.|| (LEFTARG = uuid[], RIGHTARG = uuid, FUNCTION = public.sp_uuid_cat);

CREATE FUNCTION public.format(text, name, text) RETURNS text LANGUAGE plpgsql AS
  $$ BEGIN PERFORM public.sp_record('format(text,name,text)'); RETURN pg_catalog.format($1, $2, $3); END $$;

CREATE FUNCTION public.format(text, name) RETURNS text LANGUAGE plpgsql AS
  $$ BEGIN PERFORM public.sp_record('format(text,name)'); RETURN pg_catalog.format($1, $2); END $$;

CREATE FUNCTION public.cardinality(text[]) RETURNS integer LANGUAGE plpgsql AS
  $$ BEGIN PERFORM public.sp_record('cardinality(text[])'); RETURN pg_catalog.cardinality($1); END $$;

CREATE FUNCTION public.array_to_string(text[], text) RETURNS text LANGUAGE plpgsql AS
  $$ BEGIN PERFORM public.sp_record('array_to_string(text[],text)'); RETURN pg_catalog.array_to_string($1, $2); END $$;

CREATE FUNCTION public.pg_advisory_xact_lock(integer) RETURNS void LANGUAGE plpgsql AS
  $$ BEGIN PERFORM public.sp_record('pg_advisory_xact_lock(integer)');
     PERFORM pg_catalog.pg_advisory_xact_lock($1::pg_catalog.int8); END $$;

CREATE FUNCTION public.sp_name_like(name, name) RETURNS boolean LANGUAGE plpgsql AS
  $$ BEGIN PERFORM public.sp_record('~~(name,name)'); RETURN $1::text OPERATOR(pg_catalog.~~) $2::text; END $$;
CREATE OPERATOR public.~~ (LEFTARG = name, RIGHTARG = name, FUNCTION = public.sp_name_like);
`;

function runCli(args: string[]): { code: number | null; out: string } {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    // Without PGOPTIONS, so the CLI reads the control role from the database.
    env: { ...process.env, PGOPTIONS: "", NODE_ENV: "test", STRATUM_ENCRYPTION_KEY: "x".repeat(40), DATABASE_ADMIN_URL: "" },
    // Answers yes to a confirmation prompt (stratum migrate asks one).
    input: "y\n",
    timeout: 60000,
  });
  // eslint-disable-next-line no-control-regex
  return { code: res.status, out: `${res.stdout}${res.stderr}`.replace(/\x1b\[[0-9;]*m/g, "") };
}

/** The labels that sp_record() records, one sequence each. */
const LABELS = [
  "=(oid,regclass)",
  "=(oid,regnamespace)",
  "unnest(name[])",
  "unnest(uuid[])",
  "array_agg(text)",
  "json_agg(json)",
  "json_build_object(text,uuid,text,text)",
  "json_build_object(policy row)",
  "||(uuid[],uuid)",
  "format(text,name,text)",
  "format(text,name)",
  "cardinality(text[])",
  "array_to_string(text[],text)",
  "pg_advisory_xact_lock(integer)",
  "~~(name,name)",
];

let baseline = new Map<string, number>();

async function callCounts(): Promise<Map<string, number>> {
  const res = await suPool.query<{ name: string; n: string | null }>(
    "SELECT sequencename AS name, last_value AS n FROM pg_sequences WHERE schemaname = 'public' AND sequencename OPERATOR(pg_catalog.~~) 'sp_hit %'",
  );
  return new Map(res.rows.map((r) => [r.name.slice("sp_hit ".length), Number(r.n ?? 0)]));
}

/**
 * The planted functions that ran since the last reset, with the logins that
 * ran them when the caller's transaction committed.
 */
async function hits(): Promise<{ fn: string; calls: number; who: string[] }[]> {
  const counts = await callCounts();
  const who = await suPool.query<{ who: string; fn: string }>("SELECT DISTINCT who, fn FROM public.sp_hits ORDER BY who");
  return LABELS.filter((l) => (counts.get(l) ?? 0) > (baseline.get(l) ?? 0)).map((fn) => ({
    fn,
    calls: (counts.get(fn) ?? 0) - (baseline.get(fn) ?? 0),
    who: who.rows.filter((r) => r.fn === fn).map((r) => r.who),
  }));
}

beforeAll(async () => {
  su = new pg.Client({ connectionString: BASE_URL });
  await su.connect();
  await su.query(`DROP DATABASE IF EXISTS "${DB}"`);
  for (const role of [PLANTER, APP, ADMIN]) {
    await dropTestRole(su, role);
    await su.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${PASSWORD}' NOSUPERUSER NOBYPASSRLS`);
  }
  await su.query(`CREATE DATABASE "${DB}"`);
  suPool = new pg.Pool({ connectionString: suUrl, max: 3 });
  control = await controlRoleName(suPool);
  await suPool.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; CREATE EXTENSION IF NOT EXISTS ltree`);
  await migrate({ pool: suPool, controlRole: control });
  await su.query(`GRANT "${control}" TO "${ADMIN}"`);

  // Two tenants, one under the other, so the tree checks walk a parent.
  const lib = new Stratum({ pool: suPool, logger: noopLogger });
  const root = await lib.createTenant({ name: "SP Root", slug: "sp_root" });
  await lib.createTenant({ name: "SP Child", slug: "sp_child", parent_id: root.id });
  // A schema-per-tenant tenant whose schema is migrated before the planting.
  await lib.createTenant({ name: "SP Schema", slug: "sp_schema", isolation_strategy: "SCHEMA_PER_TENANT" });
  await suPool.query("CREATE SCHEMA tenant_sp_schema");
  const first = await migrateAllSchemas({ pool: suPool, controlRole: control });
  expect(first.failed).toEqual([]);
  await suPool.query("CREATE TABLE public.sp_notes (id serial PRIMARY KEY, body text)");

  await suPool.query("CREATE TABLE public.sp_hits (who text, fn text)");
  await suPool.query("GRANT INSERT, SELECT ON public.sp_hits TO PUBLIC");
  for (const label of LABELS) {
    await suPool.query(`CREATE SEQUENCE public."sp_hit ${label}"`);
    await suPool.query(`GRANT USAGE, SELECT ON SEQUENCE public."sp_hit ${label}" TO PUBLIC`);
  }
  // The planting login: no superuser, no Stratum rights, CREATE on public.
  await suPool.query(`GRANT CREATE ON SCHEMA public TO "${PLANTER}"`);
  const planter = new pg.Client({ connectionString: planterUrl });
  await planter.connect();
  try {
    await planter.query(PLANTED);
  } finally {
    await planter.end();
  }
}, 120_000);

afterAll(async () => {
  await suPool?.end();
  await su.query(`DROP DATABASE IF EXISTS "${DB}"`);
  for (const role of [PLANTER, APP, ADMIN]) await dropTestRole(su, role);
  await su.end();
});

beforeEach(async () => {
  await suPool.query("TRUNCATE public.sp_hits");
  baseline = await callCounts();
});

describe("functions planted in a schema on the search path", () => {
  it("run when a superuser's query resolves them through the default search path", async () => {
    await suPool.query("SELECT count(*) FROM pg_class WHERE oid = to_regclass('pg_class')");
    await suPool.query("SELECT array_agg(rolname::text) FROM pg_roles");
    expect(await hits()).toEqual([
      { fn: "=(oid,regclass)", calls: expect.any(Number), who: [SUPERUSER] },
      { fn: "array_agg(text)", calls: expect.any(Number), who: [SUPERUSER] },
    ]);
  });
});

/** Runs the CLI and checks that it got as far as the output it should print. */
function cli(args: string[], code: number | null, output: RegExp): () => Promise<void> {
  return async () => {
    const res = runCli([...args, "--database-url", suUrl]);
    expect(res.out).toMatch(output);
    if (code !== null) expect(res.code, res.out).toBe(code);
  };
}

/**
 * The privileged paths, each run once with the planted functions in place.
 * Each one checks that it ran to the end (or, for db roles --apply, to the
 * refusal that the planted functions cause).
 */
const PRIVILEGED_PATHS: [string, () => Promise<void>][] = [
  [
    "inspectRoleModel through a superuser pool",
    async () => {
      const report = await inspectRoleModel({ pool: suPool, appRole: APP, adminRole: ADMIN });
      expect(report.controlRole).toBe(control);
    },
  ],
  [
    "stratumPolicyDrift through a superuser pool",
    async () => {
      expect(await stratumPolicyDrift(suPool)).toEqual([]);
    },
  ],
  [
    "Stratum.initialize() with adminPool",
    async () => {
      const appPool = new pg.Pool({ connectionString: appUrl, max: 2 });
      const adminPool = new pg.Pool({ connectionString: adminUrl, max: 2 });
      try {
        await new Stratum({ pool: appPool, adminPool, controlRole: control, logger: noopLogger }).initialize();
      } finally {
        await appPool.end();
        await adminPool.end();
      }
    },
  ],
  ["migrate() as a superuser when every migration has run", () => migrate({ pool: suPool, controlRole: control })],
  [
    "migrate() as a superuser into a new schema, with public after it on the search path",
    async () => {
      await suPool.query("CREATE SCHEMA IF NOT EXISTS sp_fresh");
      const pool = new pg.Pool({ connectionString: suUrl, max: 2, options: "-c search_path=sp_fresh,public" });
      try {
        await migrate({ pool, controlRole: control });
      } finally {
        await pool.end();
      }
      const applied = await suPool.query("SELECT count(*)::int AS n FROM sp_fresh._migrations");
      expect(applied.rows[0].n).toBeGreaterThan(30);
    },
  ],
  [
    "migration 032 run again as a superuser over the subtree helper of a non-superuser install",
    async () => {
      // As a migrating login that is not a superuser leaves it (see 032).
      await suPool.query("ALTER FUNCTION public.stratum_subtree_tenant_ids() SECURITY INVOKER RESET ALL");
      await suPool.query(fs.readFileSync(MIGRATION_032, "utf8"));
    },
  ],
  [
    "stratum db roles --apply",
    cli(["db", "roles", "--apply", "--admin-role", ADMIN, "--app-role", APP], 1, /did not create/),
  ],
  ["stratum db lock", cli(["db", "lock", "--app-role", APP], 0, /Legacy switch off/)],
  ["stratum doctor", cli(["doctor"], null, /Tenant parent cycles\s+None found/)],
  ["stratum health", cli(["health"], null, /RLS/)],
  ["stratum scan", cli(["scan"], 0, /sp_notes/)],
  ["stratum migrate <table>", cli(["migrate", "sp_notes"], 0, /Migration complete/)],
  [
    "migrateAllSchemas() as a superuser when every migration has run",
    async () => {
      const res = await migrateAllSchemas({ pool: suPool, controlRole: control });
      expect(res).toEqual({ succeeded: ["tenant_sp_schema"], failed: [] });
    },
  ],
  [
    "listTenantSchemas() of @stratum-hq/db-adapters as a superuser",
    async () => {
      const client = await suPool.connect();
      try {
        expect(await listTenantSchemas(client)).toEqual(["tenant_sp_schema"]);
      } finally {
        client.release();
      }
    },
  ],
  [
    "createPolicy() and isRLSEnabled() of @stratum-hq/db-adapters as a superuser",
    async () => {
      const client = await suPool.connect();
      try {
        await createPolicy(client, "sp_notes");
        expect(await isRLSEnabled(client, "sp_notes")).toBe(true);
      } finally {
        client.release();
      }
    },
  ],
];

describe("privileged Stratum paths", () => {
  it.each(PRIVILEGED_PATHS)("%s runs none of them", async (_name, run) => {
    await run();
    expect(await hits()).toEqual([]);
  });
});
