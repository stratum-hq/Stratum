import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import {
  createPolicy,
  enableRLS,
  createIsolationPolicy,
  enableRLSForMigration,
  isRLSEnabled,
} from "@stratum-hq/db-adapters";

/**
 * Every code path that generates a tenant_isolation policy, run against real
 * PostgreSQL. Each test reuses one connection, as a pool does: a transaction
 * sets the tenant with set_config(..., true), and then a query runs after that
 * transaction ends. The setting then reads as '' on that connection, so a
 * policy must turn '' into NULL before the uuid cast. See #394.
 *
 * The tests use a scratch database that this file creates and drops, because
 * `stratum scan` reads every table in the public schema.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, "../../cli/dist/index.js");
const CP_ISOLATION = pathToFileURL(
  path.resolve(__dirname, "../../control-plane/dist/services/isolation-service.js"),
).href;
const CP_CONNECTION = pathToFileURL(
  path.resolve(__dirname, "../../control-plane/dist/db/connection.js"),
).href;

const BASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://stratum_test:stratum_test@localhost:5433/stratum_test";

const scratchDbName = `${new URL(BASE_URL).pathname.slice(1)}_rls_nullif`;
const scratchUrl = (() => {
  const u = new URL(BASE_URL);
  u.pathname = `/${scratchDbName}`;
  return u.toString();
})();

// The policies must apply, so the reads run as a role that RLS does not skip.
const APP_ROLE = "stratum_rls_nullif_test";
const TENANT_A = "0a0a0a0a-0000-4000-8000-000000000394";
const TABLE = "gen_orders";

let admin: pg.Client;
let scratch: pg.Client;

function runCli(args: string[]): { code: number | null; out: string } {
  const res = spawnSync(process.execPath, [CLI, ...args, "--database-url", scratchUrl], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    input: "y\n",
    timeout: 30000,
  });
  return { code: res.status, out: `${res.stdout}${res.stderr}` };
}

/**
 * Give the app role access to the table and add one row for TENANT_A.
 * The owner inserts under the tenant context because the table has FORCE RLS.
 */
async function grantAndSeed(): Promise<void> {
  await scratch.query(`GRANT SELECT ON ${TABLE} TO ${APP_ROLE}`);
  await scratch.query("BEGIN");
  await scratch.query("SELECT set_config('app.current_tenant_id', $1, true)", [TENANT_A]);
  await scratch.query(`INSERT INTO ${TABLE} (id, tenant_id) VALUES (1, $1)`, [TENANT_A]);
  await scratch.query("COMMIT");
}

/**
 * Read the table twice on one connection as the app role: first inside a
 * transaction with the tenant set, then after that transaction ends.
 */
async function readBeforeAndAfterContext(): Promise<{ inside: number; after: number }> {
  const app = new pg.Client({ connectionString: scratchUrl });
  await app.connect();
  try {
    await app.query(`SET ROLE ${APP_ROLE}`);
    await app.query("BEGIN");
    await app.query("SELECT set_config('app.current_tenant_id', $1, true)", [TENANT_A]);
    const inside = await app.query(`SELECT id FROM ${TABLE}`);
    await app.query("COMMIT");
    const after = await app.query(`SELECT id FROM ${TABLE}`);
    return { inside: inside.rowCount ?? 0, after: after.rowCount ?? 0 };
  } finally {
    await app.end();
  }
}

/** Run fn on a pool client, because the db-adapters helpers take a PoolClient. */
async function withScratchClient(fn: (c: pg.PoolClient) => Promise<void>): Promise<void> {
  const pool = new pg.Pool({ connectionString: scratchUrl, max: 1 });
  const c = await pool.connect();
  try {
    await fn(c);
  } finally {
    c.release();
    await pool.end();
  }
}

beforeAll(async () => {
  admin = new pg.Client({ connectionString: BASE_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${scratchDbName}"`);
  await admin.query(`CREATE DATABASE "${scratchDbName}"`);
  await admin.query(`DO $$ BEGIN
    CREATE ROLE ${APP_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
  scratch = new pg.Client({ connectionString: scratchUrl });
  await scratch.connect();
});

afterAll(async () => {
  await scratch?.end();
  await admin?.query(`DROP DATABASE IF EXISTS "${scratchDbName}"`);
  await admin?.end();
});

beforeEach(async () => {
  await scratch.query(`DROP SCHEMA IF EXISTS other CASCADE; DROP SCHEMA IF EXISTS app CASCADE;`);
  await scratch.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  await scratch.query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
  await scratch.query(`CREATE TABLE ${TABLE} (id INT PRIMARY KEY, tenant_id UUID NOT NULL)`);
});

describe("generated tenant_isolation policies after the tenant context ends", () => {
  it("db-adapters createPolicy returns no rows and raises no error", async () => {
    await withScratchClient(async (c) => {
      await enableRLS(c, TABLE);
      await createPolicy(c, TABLE);
    });
    await grantAndSeed();

    expect(await readBeforeAndAfterContext()).toEqual({ inside: 1, after: 0 });
  });

  it("db-adapters createIsolationPolicy returns no rows and raises no error", async () => {
    await withScratchClient(async (c) => {
      await enableRLSForMigration(c, TABLE);
      await createIsolationPolicy(c, TABLE);
    });
    await grantAndSeed();

    expect(await readBeforeAndAfterContext()).toEqual({ inside: 1, after: 0 });
  });

  it("control-plane setupRLSForTable returns no rows and raises no error", async () => {
    // A child process gives the control plane one module graph and its own
    // DATABASE_URL, so closePool() ends the pool that setupRLSForTable used.
    const res = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const iso = await import(${JSON.stringify(CP_ISOLATION)});
         const db = await import(${JSON.stringify(CP_CONNECTION)});
         try { await iso.setupRLSForTable(${JSON.stringify(TABLE)}); } finally { await db.closePool(); }`,
      ],
      { encoding: "utf8", env: { ...process.env, DATABASE_URL: scratchUrl }, timeout: 30000 },
    );
    expect(res.status, `${res.stdout}${res.stderr}`).toBe(0);
    await grantAndSeed();

    expect(await readBeforeAndAfterContext()).toEqual({ inside: 1, after: 0 });
  });

  it("stratum migrate returns no rows and raises no error", async () => {
    const { code, out } = runCli(["migrate", TABLE]);
    expect(code, out).toBe(0);
    await grantAndSeed();

    expect(await readBeforeAndAfterContext()).toEqual({ inside: 1, after: 0 });
  });

  it("stratum scan --generate SQL returns no rows and raises no error", async () => {
    const { code, out } = runCli(["scan", "--generate"]);
    expect(code, out).toBe(0);
    const start = out.indexOf("-- Stratum Migration Scanner");
    expect(start, out).toBeGreaterThanOrEqual(0);
    await scratch.query(out.slice(start));
    await grantAndSeed();

    expect(await readBeforeAndAfterContext()).toEqual({ inside: 1, after: 0 });
  });
});

describe("db-adapters createPolicy with an existing tenant_isolation policy", () => {
  it("rejects a same-named policy that does not filter by tenant, and leaves it in place", async () => {
    await scratch.query(`CREATE POLICY tenant_isolation ON ${TABLE} USING (true)`);

    await withScratchClient(async (c) => {
      await enableRLS(c, TABLE);
      await expect(createPolicy(c, TABLE)).rejects.toThrow(/tenant_isolation.*does not filter by tenant/);
    });

    const { rows } = await scratch.query(
      `SELECT qual FROM pg_policies WHERE tablename = $1 AND policyname = 'tenant_isolation'`,
      [TABLE],
    );
    expect(rows).toEqual([{ qual: "true" }]);
  });

  it("rejects a same-named policy whose WITH CHECK does not filter by tenant", async () => {
    await scratch.query(
      `CREATE POLICY tenant_isolation ON ${TABLE}
       USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
       WITH CHECK (true)`,
    );

    await withScratchClient(async (c) => {
      await expect(createPolicy(c, TABLE)).rejects.toThrow(/WITH CHECK.*does not filter by tenant/);
    });
  });

  it("rejects a same-named policy that compares tenant_id with a different setting", async () => {
    await scratch.query(
      `CREATE POLICY tenant_isolation ON ${TABLE}
       USING (tenant_id = NULLIF(current_setting('app.other_tenant', true), '')::uuid)`,
    );

    await withScratchClient(async (c) => {
      await expect(createPolicy(c, TABLE)).rejects.toThrow(/does not filter by tenant/);
    });
  });

  it("accepts the policy it generated itself when called again", async () => {
    await withScratchClient(async (c) => {
      await enableRLS(c, TABLE);
      await createPolicy(c, TABLE);
      await createPolicy(c, TABLE);
    });
    await grantAndSeed();

    expect(await readBeforeAndAfterContext()).toEqual({ inside: 1, after: 0 });
  });

  it("accepts the policy that stratum migrate generates", async () => {
    const { code, out } = runCli(["migrate", TABLE]);
    expect(code, out).toBe(0);

    await withScratchClient(async (c) => {
      await expect(createPolicy(c, TABLE)).resolves.toBeUndefined();
    });
  });

  it("creates the policy when only a same-named table in another schema has one", async () => {
    await scratch.query(`CREATE SCHEMA other`);
    await scratch.query(`CREATE TABLE other.${TABLE} (id INT PRIMARY KEY, tenant_id UUID NOT NULL)`);
    await scratch.query(`CREATE POLICY tenant_isolation ON other.${TABLE} USING (true)`);

    await withScratchClient(async (c) => {
      await enableRLS(c, TABLE);
      await createPolicy(c, TABLE);
    });
    await grantAndSeed();

    expect(await readBeforeAndAfterContext()).toEqual({ inside: 1, after: 0 });
  });
});

describe("db-adapters isRLSEnabled", () => {
  it("reports the table the name resolves to, not a same-named table in another schema", async () => {
    // public.gen_orders (from beforeEach) has RLS; app.gen_orders, which the
    // search_path resolves the name to, does not.
    await scratch.query(`ALTER TABLE public.${TABLE} ENABLE ROW LEVEL SECURITY`);
    await scratch.query(`CREATE SCHEMA app`);
    await scratch.query(`CREATE TABLE app.${TABLE} (id INT PRIMARY KEY, tenant_id UUID NOT NULL)`);

    const pool = new pg.Pool({ connectionString: scratchUrl, max: 1, options: "-c search_path=app,public" });
    const c = await pool.connect();
    try {
      expect(await isRLSEnabled(c, TABLE)).toBe(false);
      await c.query(`ALTER TABLE app.${TABLE} ENABLE ROW LEVEL SECURITY`);
      expect(await isRLSEnabled(c, TABLE)).toBe(true);
    } finally {
      c.release();
      await pool.end();
    }
  });

  it("reports false for a table that does not exist", async () => {
    await withScratchClient(async (c) => {
      expect(await isRLSEnabled(c, "no_such_table")).toBe(false);
    });
  });
});
