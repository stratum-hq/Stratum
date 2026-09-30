import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import { getPool, closePool, runMigrations, cleanTestData } from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";
import {
  GATE_PREFIX,
  installGate,
  removeGate,
  closeGate,
  track,
  waitForLockWaiters,
} from "./helpers/interleave.js";

/**
 * Sibling reorders and slug renames racing other tree writes in real,
 * interleaved Postgres transactions (see helpers/interleave.ts).
 */

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://stratum_test:stratum_test@localhost:5433/stratum_test";

let stratum: Stratum;

beforeAll(async () => {
  await runMigrations();
  await installGate(getPool());
  stratum = new Stratum({ pool: getPool() });
});

afterEach(async () => {
  await cleanTestData();
});

afterAll(async () => {
  await removeGate(getPool());
  await closePool();
});

function node(slugPrefix: string, parent_id: string | null = null) {
  const slug = uniqueSlug(slugPrefix);
  return stratum.createTenant({ name: slug, slug, parent_id });
}

async function childOrder(parentId: string): Promise<Array<{ id: string; sort_order: number }>> {
  const res = await getPool().query<{ id: string; sort_order: number }>(
    `SELECT id, sort_order FROM tenants WHERE parent_id = $1 ORDER BY sort_order, created_at`,
    [parentId],
  );
  return res.rows;
}

/** Rows among `ids` whose ancestry_ltree is not their parent's ltree plus their own slug. */
async function inconsistentLtree(ids: string[]): Promise<string[]> {
  const res = await getPool().query<{ id: string }>(
    `SELECT c.id FROM tenants c
     LEFT JOIN tenants p ON p.id = c.parent_id
     WHERE c.id = ANY($1::uuid[])
       AND c.ancestry_ltree IS DISTINCT FROM
           CASE WHEN c.parent_id IS NULL THEN c.slug::ltree
                ELSE p.ancestry_ltree || c.slug::ltree END`,
    [ids],
  );
  return res.rows.map((r) => r.id);
}

describe("sibling reorder under concurrency (integration)", () => {
  it("runs two reorders of the same siblings one after the other instead of deadlocking", async () => {
    const pool = getPool();
    const P = await node("r12");
    const S0 = await node(GATE_PREFIX, P.id);
    const S1 = await node("r12", P.id);
    const S2 = await node("r12", P.id);
    await stratum.reorderTenant(S0.id, 0);

    const gate = await closeGate(DATABASE_URL);
    // Renumbers S2, then stops at S0.
    const first = track(stratum.reorderTenant(S2.id, 0));
    await waitForLockWaiters(pool, 1);
    const second = track(stratum.reorderTenant(S1.id, 0));
    await waitForLockWaiters(pool, 2, second);
    await gate.open();

    const results = await Promise.all([first.result, second.result]);
    expect(results.map((r) => (r.ok ? "ok" : String((r.error as Error).message)))).toEqual(["ok", "ok"]);
    // First: S2, S0, S1. Then S1 moves to the front: S1, S2, S0.
    expect(await childOrder(P.id)).toEqual([
      { id: S1.id, sort_order: 0 },
      { id: S2.id, sort_order: 1 },
      { id: S0.id, sort_order: 2 },
    ]);
  });

  it("reorders a tenant among its new siblings when it is moved concurrently", async () => {
    const pool = getPool();
    const P = await node("r12");
    const Q = await node("r12");
    const T = await node(GATE_PREFIX, P.id);
    await node("r12", P.id);
    const Q0 = await node("r12", Q.id);
    const Q1 = await node("r12", Q.id);
    await stratum.reorderTenant(Q0.id, 0);

    const gate = await closeGate(DATABASE_URL);
    const move = track(stratum.moveTenant(T.id, Q.id));
    await waitForLockWaiters(pool, 1);
    const reorder = track(stratum.reorderTenant(T.id, 0));
    await waitForLockWaiters(pool, 2, reorder);
    await gate.open();

    const [m, r] = await Promise.all([move.result, reorder.result]);
    expect(m.ok).toBe(true);
    expect(r.ok).toBe(true);
    expect(await childOrder(Q.id)).toEqual([
      { id: T.id, sort_order: 0 },
      { id: Q0.id, sort_order: 1 },
      { id: Q1.id, sort_order: 2 },
    ]);
  });
});

describe("slug rename under concurrency (integration)", () => {
  it("keeps a new grandchild's ltree correct when an ancestor is renamed while it is created", async () => {
    const pool = getPool();
    const X = await node(GATE_PREFIX);
    const Y = await node("r12", X.id);

    const gate = await closeGate(DATABASE_URL);
    const rename = track(stratum.updateTenant(X.id, { slug: uniqueSlug(GATE_PREFIX) }));
    await waitForLockWaiters(pool, 1);
    const create = track(node("r12", Y.id));
    await waitForLockWaiters(pool, 2, create);
    await gate.open();

    const [rn, c] = await Promise.all([rename.result, create.result]);
    expect(rn.ok).toBe(true);
    expect(c.ok).toBe(true);
    const C = c.ok ? c.value : null;
    expect(await inconsistentLtree([X.id, Y.id, C!.id])).toEqual([]);
  });

  it("keeps a new grandchild's ltree correct when an ancestor is renamed after its create started", async () => {
    const pool = getPool();
    const X = await node("r12");
    const Y = await node("r12", X.id);

    const gate = await closeGate(DATABASE_URL);
    const create = track(node(GATE_PREFIX, Y.id));
    await waitForLockWaiters(pool, 1);
    const rename = track(stratum.updateTenant(X.id, { slug: uniqueSlug("r12") }));
    await waitForLockWaiters(pool, 2, rename);
    await gate.open();

    const [c, rn] = await Promise.all([create.result, rename.result]);
    expect(rn.ok).toBe(true);
    expect(c.ok).toBe(true);
    const C = c.ok ? c.value : null;
    expect(await inconsistentLtree([X.id, Y.id, C!.id])).toEqual([]);
  });

  it("keeps ltree paths correct when the old parent is renamed during a move", async () => {
    const pool = getPool();
    const A = await node("r12");
    const B = await node("r12");
    const X = await node(GATE_PREFIX, A.id);
    const Y = await node("r12", X.id);

    const gate = await closeGate(DATABASE_URL);
    const move = track(stratum.moveTenant(X.id, B.id));
    await waitForLockWaiters(pool, 1);
    const rename = track(stratum.updateTenant(A.id, { slug: uniqueSlug("r12") }));
    await waitForLockWaiters(pool, 2, rename);
    await gate.open();

    const [m, rn] = await Promise.all([move.result, rename.result]);
    expect(m.ok).toBe(true);
    expect(rn.ok).toBe(true);
    expect(await inconsistentLtree([A.id, B.id, X.id, Y.id])).toEqual([]);
  });
});
