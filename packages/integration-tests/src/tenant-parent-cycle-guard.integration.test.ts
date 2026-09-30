import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import pg from "pg";
import { Stratum } from "@stratum-hq/lib";
import { getPool, closePool, runMigrations, cleanTestData } from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

/**
 * The database itself refuses a parent_id that would make a tenant its own
 * ancestor, whoever writes it, and a cycle already present in the data (for
 * example one written with triggers disabled) stops a later write with the
 * same error instead of propagating ancestry_ltree around the loop.
 *
 * Each test runs its raw SQL with a statement timeout, so a write that does not
 * stop on its own fails the test quickly instead of running away.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://stratum_test:stratum_test@localhost:5433/stratum_test";

let stratum: Stratum;
let client: pg.Client;

beforeAll(async () => {
  await runMigrations();
  stratum = new Stratum({ pool: getPool() });
});

afterEach(async () => {
  if (client) {
    await client.end().catch(() => {});
  }
  await cleanTestData();
});

afterAll(async () => {
  await closePool();
});

async function rawClient(): Promise<pg.Client> {
  client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  await client.query(`SET statement_timeout = '5s'`);
  await client.query(`SET app.bypass_rls = 'on'`);
  return client;
}

async function chain(length: number) {
  const nodes = [];
  let parent_id: string | null = null;
  for (let i = 0; i < length; i++) {
    const slug = uniqueSlug("r11");
    const t = await stratum.createTenant({ name: slug, slug, parent_id });
    nodes.push(t);
    parent_id = t.id;
  }
  return nodes;
}

async function rejection(p: Promise<unknown>): Promise<{ message: string; code?: string }> {
  try {
    await p;
  } catch (err) {
    const e = err as { message: string; code?: string };
    return { message: e.message, code: e.code };
  }
  throw new Error("expected the statement to be refused");
}

describe("tenant parent cycle guard (integration)", () => {
  it("refuses a parent_id update that makes a tenant its own ancestor", async () => {
    const [A, , C] = await chain(3);
    const c = await rawClient();

    const err = await rejection(c.query(`UPDATE tenants SET parent_id = $1 WHERE id = $2`, [C.id, A.id]));

    expect(err.code).toBe("23514");
    expect(err.message).toMatch(/cycle/);
    const row = await getPool().query(`SELECT parent_id FROM tenants WHERE id = $1`, [A.id]);
    expect(row.rows[0].parent_id).toBeNull();
  });

  it("refuses a tenant that is its own parent", async () => {
    const [A] = await chain(1);
    const c = await rawClient();

    const err = await rejection(c.query(`UPDATE tenants SET parent_id = id WHERE id = $1`, [A.id]));

    expect(err.code).toBe("23514");
    expect(err.message).toMatch(/cycle/);
  });

  it("stops a slug rename inside a parent cycle already present in the data", async () => {
    const [A, B, C] = await chain(3);
    const c = await rawClient();
    // Plant the cycle A -> C -> B -> A with every trigger switched off, the way
    // corrupt data could already be sitting in a table.
    await c.query(`BEGIN`);
    await c.query(`SET LOCAL session_replication_role = replica`);
    await c.query(`UPDATE tenants SET parent_id = $1 WHERE id = $2`, [C.id, A.id]);
    await c.query(`COMMIT`);

    const err = await rejection(
      c.query(`UPDATE tenants SET slug = $1 WHERE id = $2`, [uniqueSlug("r11"), B.id]),
    );

    expect(err.code).toBe("23514");
    expect(err.message).toMatch(/cycle/);
  });

  it("still moves and renames tenants in a deep chain", async () => {
    const nodes = await chain(12);
    const other = (await chain(1))[0];

    await stratum.moveTenant(nodes[1].id, other.id);
    await stratum.updateTenant(nodes[3].id, { slug: uniqueSlug("r11") });

    const leaf = await getPool().query(
      `SELECT nlevel(ancestry_ltree) AS levels, depth FROM tenants WHERE id = $1`,
      [nodes[11].id],
    );
    // other -> nodes[1] -> ... -> nodes[11]: 12 levels, depth 11.
    expect(leaf.rows[0]).toEqual({ levels: 12, depth: 11 });
  });
});
