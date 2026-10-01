import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { Stratum } from "@stratum-hq/lib";
import { getPool, closePool, runMigrations, cleanTestData } from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

/**
 * Runs the built `stratum doctor` against tenant rows whose parent chain loops.
 * Migration 029 refuses every write that makes such a loop, so the test plants
 * one with triggers off, the way corrupt data can already sit in a table.
 *
 * The CLI connects as a NOSUPERUSER, NOBYPASSRLS role. Migration 019 puts FORCE
 * RLS on tenants, so a check that does not set the bypass sees no rows and
 * reports a pass it never checked.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, "../../cli/dist/index.js");
const DOCS = path.resolve(__dirname, "../../../website/src/content/docs/packages/cli.mdx");

const BASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://stratum_test:stratum_test@localhost:5433/stratum_test";

const APP_ROLE = "stratum_cli_cycle_test";
const appUrl = (() => {
  const u = new URL(BASE_URL);
  u.username = APP_ROLE;
  u.password = APP_ROLE;
  return u.toString();
})();

let stratum: Stratum;

function runDoctor(): { code: number | null; out: string } {
  const res = spawnSync(process.execPath, [CLI, "doctor", "--database-url", appUrl], {
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "test", STRATUM_ENCRYPTION_KEY: "doctor-test-key" },
    timeout: 30000,
  });
  // eslint-disable-next-line no-control-regex
  const out = `${res.stdout}${res.stderr}`.replace(/\x1b\[[0-9;]*m/g, "");
  return { code: res.status, out };
}

/** Returns the doctor output line for the parent cycle check. */
function cycleLine(out: string): string {
  const line = out.split("\n").find((l) => l.includes("Tenant parent cycles"));
  expect(line, out).toBeDefined();
  return line!;
}

async function chain(length: number) {
  const nodes = [];
  let parent_id: string | null = null;
  for (let i = 0; i < length; i++) {
    const slug = uniqueSlug("cyc");
    const t = await stratum.createTenant({ name: `Cycle ${slug}`, slug, parent_id });
    nodes.push(t);
    parent_id = t.id;
  }
  return nodes;
}

/**
 * Sets one parent_id with every trigger off for this transaction only.
 * Only the 029 guard refuses the write. The 024 ltree triggers are off as
 * well, because on a loop they would carry the ltree around it without end.
 */
async function plantParent(id: string, parentId: string): Promise<void> {
  const c = await getPool().connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL session_replication_role = replica");
    await c.query("UPDATE tenants SET parent_id = $1 WHERE id = $2", [parentId, id]);
    await c.query("COMMIT");
  } finally {
    c.release();
  }
}

/**
 * Runs the repair SQL as the CLI docs print it. The test reads the block from
 * the docs page, so the docs and the tested SQL cannot differ. It connects as
 * the NOBYPASSRLS role, the way an operator connects.
 */
async function runDocumentedRepair(memberId: string, newParentSql: string): Promise<void> {
  const doc = fs.readFileSync(DOCS, "utf8");
  const section = doc.slice(doc.indexOf("#### Repair a tenant parent cycle"));
  const sql = /```sql\n([\s\S]*?)```/.exec(section)?.[1];
  expect(sql, "repair SQL block in cli.mdx").toBeDefined();
  const filled = sql!
    .replace("'<new-parent-id>'", newParentSql)
    .replace("<cycle-member-id>", memberId);
  expect(filled).not.toMatch(/'<[a-z-]+>'/);
  const c = new pg.Client({ connectionString: appUrl });
  await c.connect();
  try {
    await c.query(`SET statement_timeout = '5s'`);
    await c.query(filled);
  } finally {
    await c.end();
  }
}

/**
 * Returns the slugs of tenants whose ancestry_path, depth or ancestry_ltree
 * do not match their parent_id chain. The expected values come from this
 * TypeScript walk, not from the SQL under test.
 */
async function inconsistentTenants(): Promise<string[]> {
  const res = await getPool().query(
    `SELECT id, parent_id, slug, ancestry_path, depth, ancestry_ltree::text AS lt FROM tenants`,
  );
  const rows = res.rows as Array<{
    id: string;
    parent_id: string | null;
    slug: string;
    ancestry_path: string;
    depth: number;
    lt: string;
  }>;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const bad: string[] = [];
  for (const r of rows) {
    const ancestors: string[] = [];
    // The length limit ends the walk on a cycle that is still in the data.
    for (let p = r.parent_id; p && ancestors.length <= rows.length; p = byId.get(p)?.parent_id ?? null) {
      ancestors.unshift(p);
    }
    const expectedPath = ancestors.length === 0 ? "/" : `/${ancestors.join("/")}`;
    const expectedLtree = [...ancestors.map((id) => byId.get(id)!.slug), r.slug].join(".");
    if (r.ancestry_path !== expectedPath || r.depth !== ancestors.length || r.lt !== expectedLtree) {
      bad.push(r.slug);
    }
  }
  return bad.sort();
}

beforeAll(async () => {
  await runMigrations();
  const pool = getPool();
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
        CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_ROLE}' NOSUPERUSER NOBYPASSRLS;
      END IF;
    END $$;
  `);
  await pool.query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
  await pool.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`);
  // The documented repair writes tenants as this role.
  await pool.query(`GRANT UPDATE ON tenants TO ${APP_ROLE}`);
  stratum = new Stratum({ pool });
});

afterEach(async () => {
  await cleanTestData();
});

afterAll(async () => {
  const pool = getPool();
  await pool.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${APP_ROLE}`);
  await pool.query(`REVOKE ALL ON SCHEMA public FROM ${APP_ROLE}`);
  await pool.query(`DROP ROLE IF EXISTS ${APP_ROLE}`);
  await closePool();
});

describe("stratum doctor: tenant parent cycles", () => {
  it("passes the cycle check on a clean tenant tree", async () => {
    await cleanTestData();
    await chain(3);

    const { code, out } = runDoctor();

    expect(cycleLine(out)).toContain("✓");
    expect(cycleLine(out)).toContain("None found");
    expect(code, out).toBe(0);
  });

  it("reports a three-tenant cycle by name and exits non-zero", async () => {
    const [A, B, C] = await chain(3);
    // A -> C -> B -> A
    await plantParent(A.id, C.id);

    const { code, out } = runDoctor();

    expect(cycleLine(out)).toContain("✗");
    expect(cycleLine(out)).toContain("1 cycle(s)");
    for (const t of [A, B, C]) expect(out).toContain(t.name);
    expect(out).toMatch(/parent_id .*outside the cycle.*NULL/);
    expect(out).toMatch(/recompute ancestry_path and depth: \S+#repair-a-tenant-parent-cycle/);
    expect(code, out).toBe(1);
  });

  it("moveTenant of a cycle member can leave another member with a wrong ancestry_path and depth", async () => {
    const [X] = await chain(1);
    const [A, B, C] = await chain(3);
    await plantParent(A.id, C.id); // A -> C -> B -> A

    // moveTenant derives the new paths from the stored ancestry_path of B.
    // A is now below C, but its stored path still says it is a root.
    await stratum.moveTenant(B.id, X.id);

    expect(await inconsistentTenants()).toEqual([A.slug]);
  });

  it("the documented repair to a parent outside the cycle leaves every tenant consistent", async () => {
    const [X] = await chain(1);
    const [A, B, C] = await chain(4);
    await plantParent(A.id, C.id); // A -> C -> B -> A; the 4th tenant hangs under C
    expect(await inconsistentTenants()).toContain(A.slug);

    await runDocumentedRepair(B.id, `'${X.id}'`);

    expect(await inconsistentTenants()).toEqual([]);
    const { code, out } = runDoctor();
    expect(cycleLine(out)).toContain("None found");
    expect(code, out).toBe(0);
  });

  it("the documented repair with NULL makes the member a root and leaves every tenant consistent", async () => {
    const [A, B, C] = await chain(4);
    await plantParent(A.id, C.id);

    await runDocumentedRepair(B.id, "NULL");

    expect(await inconsistentTenants()).toEqual([]);
    const row = await getPool().query(
      `SELECT parent_id, depth, ancestry_path FROM tenants WHERE id = $1`,
      [B.id],
    );
    expect(row.rows[0]).toEqual({ parent_id: null, depth: 0, ancestry_path: "/" });
    const { code, out } = runDoctor();
    expect(cycleLine(out)).toContain("None found");
    expect(code, out).toBe(0);
  });

  it("reports a tenant that is its own parent", async () => {
    const [A, B] = await chain(2);
    await plantParent(B.id, B.id);

    const { code, out } = runDoctor();

    expect(cycleLine(out)).toContain("1 cycle(s)");
    const cycleDetails = out.split("\n").filter((l) => l.includes("Cycle:")).join("\n");
    expect(cycleDetails).toContain(B.name);
    expect(cycleDetails).not.toContain(A.name);
    expect(code, out).toBe(1);
  });

  it("reports each of two separate cycles once and leaves out the tenants below them", async () => {
    const [A, B, C, below] = await chain(4);
    const [D, E] = await chain(2);
    await plantParent(A.id, B.id); // A <-> B; C and `below` hang under the loop
    await plantParent(D.id, E.id); // D <-> E

    const { code, out } = runDoctor();

    expect(cycleLine(out)).toContain("2 cycle(s)");
    const cycleDetails = out.split("\n").filter((l) => l.includes("Cycle:"));
    expect(cycleDetails).toHaveLength(2);
    expect(cycleDetails.join("\n")).not.toContain(C.name);
    expect(cycleDetails.join("\n")).not.toContain(below.name);
    for (const t of [A, B, D, E]) expect(cycleDetails.join("\n")).toContain(t.name);
    expect(code, out).toBe(1);
  });
});
