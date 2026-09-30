import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
    expect(code, out).toBe(1);
  });

  it("passes again after the fix it states: parent_id of one member set to NULL", async () => {
    const [A, , C] = await chain(3);
    await plantParent(A.id, C.id);
    // The 029 guard is on again here, so the fix must be a write it accepts.
    await getPool().query(
      `UPDATE tenants SET parent_id = NULL WHERE id = $1`,
      [A.id],
    );

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
