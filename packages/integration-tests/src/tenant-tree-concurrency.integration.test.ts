import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import {
  PermissionMode,
  RevocationMode,
  TenantCycleDetectedError,
  TenantSuspendedError,
} from "@stratum-hq/core";
import { getPool, closePool, runMigrations, cleanTestData, getAdminPool } from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";
import {
  GATE_PREFIX,
  installGate,
  removeGate,
  closeGate,
  track,
  waitForLockWaiters,
  inconsistentPaths,
  hasParentCycle,
  activeUnderInactive,
} from "./helpers/interleave.js";

/**
 * Structural tree writes (create, batch create, move) and lifecycle
 * transitions (suspend, resume) racing each other in real, interleaved
 * Postgres transactions. Each test stops one transaction at a known statement
 * (see helpers/interleave.ts), runs the competing operation until it finishes
 * or blocks, and then lets the first one continue.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://stratum_test:stratum_test@localhost:5433/stratum_test";

let stratum: Stratum;

beforeAll(async () => {
  await runMigrations();
  await installGate(getPool());
  stratum = new Stratum({ pool: getPool(), adminPool: getAdminPool() });
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

describe("tenant tree writes under concurrency (integration)", () => {
  it("keeps a new grandchild's ancestry path correct when its subtree is moved concurrently", async () => {
    const pool = getPool();
    const A = await node("a9t");
    const B = await node("a9t");
    const X = await node("a9t", A.id);
    const Y = await node("a9t", X.id);

    const gate = await closeGate(DATABASE_URL);
    const create = track(node(GATE_PREFIX, Y.id));
    await waitForLockWaiters(pool, 1);
    const move = track(stratum.moveTenant(X.id, B.id));
    await waitForLockWaiters(pool, 2, move);
    await gate.open();

    const [c, m] = await Promise.all([create.result, move.result]);
    expect(c.ok).toBe(true);
    expect(m.ok).toBe(true);
    const C = c.ok ? c.value : null;
    expect(await inconsistentPaths(pool, [X.id, Y.id, C!.id])).toEqual([]);
  });

  it("rejects one of two crossing moves instead of forming a parent cycle", async () => {
    const pool = getPool();
    const A = await node(GATE_PREFIX);
    const B = await node(GATE_PREFIX);
    const E = await node("a9t", A.id);
    const D = await node("a9t", B.id);

    const gate = await closeGate(DATABASE_URL);
    const first = track(stratum.moveTenant(A.id, D.id));
    await waitForLockWaiters(pool, 1);
    const second = track(stratum.moveTenant(B.id, E.id));
    await waitForLockWaiters(pool, 2, second);
    await gate.open();

    const results = await Promise.all([first.result, second.result]);
    const failures = results.filter((r) => !r.ok);
    expect(failures).toHaveLength(1);
    expect(failures[0].ok === false && failures[0].error).toBeInstanceOf(TenantCycleDetectedError);
    const ids = [A.id, B.id, D.id, E.id];
    expect(await hasParentCycle(pool, ids)).toBe(false);
    expect(await inconsistentPaths(pool, ids)).toEqual([]);
  });

  it("keeps batch-created children on the parent's current path when the parent is moved concurrently", async () => {
    const pool = getPool();
    const A = await node("a9t");
    const B = await node("a9t");
    const Y = await node(GATE_PREFIX, A.id);

    const gate = await closeGate(DATABASE_URL);
    const move = track(stratum.moveTenant(Y.id, B.id));
    await waitForLockWaiters(pool, 1);
    const childSlug = uniqueSlug("a9t");
    const batch = track(
      stratum.batchCreateTenants([{ name: childSlug, slug: childSlug, parent_id: Y.id }]),
    );
    await waitForLockWaiters(pool, 2, batch);
    await gate.open();

    const [m, b] = await Promise.all([move.result, batch.result]);
    expect(m.ok).toBe(true);
    expect(b.ok).toBe(true);
    const created = b.ok ? b.value.created : [];
    expect(created).toHaveLength(1);
    expect(await inconsistentPaths(pool, [Y.id, created[0].id])).toEqual([]);
  });

  it("never leaves an active child under a parent suspended while the child was being created", async () => {
    const pool = getPool();
    const P = await node("a9t");

    const gate = await closeGate(DATABASE_URL);
    const create = track(node(GATE_PREFIX, P.id));
    await waitForLockWaiters(pool, 1);
    const suspend = track(stratum.suspendTenant(P.id));
    await waitForLockWaiters(pool, 2, suspend);
    await gate.open();

    const [c] = await Promise.all([create.result, suspend.result]);
    const ids = [P.id, ...(c.ok ? [c.value.id] : [])];
    expect(await activeUnderInactive(pool, ids)).toEqual([]);
  });

  it("never leaves a resumed child active under a parent suspended at the same time", async () => {
    const pool = getPool();
    const P = await node("a9t");
    const X = await node(GATE_PREFIX, P.id);
    await stratum.suspendTenant(X.id);

    const gate = await closeGate(DATABASE_URL);
    const resume = track(stratum.resumeTenant(X.id));
    await waitForLockWaiters(pool, 1);
    const suspend = track(stratum.suspendTenant(P.id));
    await waitForLockWaiters(pool, 2, suspend);
    await gate.open();

    await Promise.all([resume.result, suspend.result]);
    expect(await activeUnderInactive(pool, [P.id, X.id])).toEqual([]);
  });
});

describe("tenant tree writes under a suspended parent (integration)", () => {
  it("refuses to move a tenant under a suspended parent", async () => {
    const P = await node("a9t");
    await stratum.suspendTenant(P.id);
    const X = await node("a9t");

    await expect(stratum.moveTenant(X.id, P.id)).rejects.toBeInstanceOf(TenantSuspendedError);
    expect((await stratum.getTenant(X.id)).parent_id).toBeNull();
  });

  it("refuses to batch-create a tenant under a suspended parent", async () => {
    const P = await node("a9t");
    await stratum.suspendTenant(P.id);
    const slug = uniqueSlug("a9t");

    const result = await stratum.batchCreateTenants([{ name: slug, slug, parent_id: P.id }]);
    expect(result.created).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    const rows = await getPool().query("SELECT 1 FROM tenants WHERE slug = $1", [slug]);
    expect(rows.rows).toHaveLength(0);
  });
});

/**
 * A subtree query reads the tenant's own ancestry_path and then selects rows by
 * that prefix, in two statements. A move that commits between them would leave
 * the prefix stale, so the query would miss the subtree. Each test stops a move
 * of the subtree, starts the subtree operation, and requires it to wait for the
 * move and then act on the moved subtree.
 */
describe("subtree queries during a move (integration)", () => {
  async function movingSubtree() {
    const A = await node("a9t");
    const B = await node("a9t");
    const X = await node(GATE_PREFIX, A.id);
    const Y = await node("a9t", X.id);
    const Z = await node("a9t", Y.id);
    return { B, X, Y, Z };
  }

  async function runDuringMove<T>(movedId: string, newParentId: string, op: () => Promise<T>) {
    const pool = getPool();
    const gate = await closeGate(DATABASE_URL);
    const move = track(stratum.moveTenant(movedId, newParentId));
    await waitForLockWaiters(pool, 1);
    const during = track(op());
    await waitForLockWaiters(pool, 2, during);
    const settledBeforeMove = during.settled();
    await gate.open();
    const [m, d] = await Promise.all([move.result, during.result]);
    expect(m.ok).toBe(true);
    expect(settledBeforeMove).toBe(false);
    return d;
  }

  it("getDescendants waits for a move of the subtree and returns the moved rows", async () => {
    const { B, X, Y, Z } = await movingSubtree();

    const d = await runDuringMove(X.id, B.id, () => stratum.getDescendants(X.id));

    expect(d.ok).toBe(true);
    const rows = d.ok ? d.value : [];
    expect(rows.map((r) => r.id).sort()).toEqual([Y.id, Z.id].sort());
    expect(rows.every((r) => r.ancestry_path.startsWith(`/${B.id}/${X.id}`))).toBe(true);
  });

  it("CASCADE permission revocation waits for a move of the subtree and reaches every descendant", async () => {
    const { B, X, Y, Z } = await movingSubtree();
    const perm = {
      key: "feature:moving",
      mode: PermissionMode.INHERITED,
      revocation_mode: RevocationMode.CASCADE,
    };
    const root = await stratum.createPermission(X.id, perm);
    await stratum.createPermission(Y.id, perm);
    await stratum.createPermission(Z.id, perm);

    const d = await runDuringMove(X.id, B.id, () => stratum.deletePermission(X.id, root.id));

    expect(d.ok).toBe(true);
    const left = await getPool().query(
      `SELECT 1 FROM permission_policies WHERE key = $1`,
      [perm.key],
    );
    expect(left.rows).toHaveLength(0);
  });

  it("CASCADE ABAC revocation waits for a move of the subtree and reaches every descendant", async () => {
    const { B, X, Y, Z } = await movingSubtree();
    const policy = {
      name: "moving_gate",
      resource_type: "report",
      action: "read",
      effect: "allow" as const,
      conditions: [],
    };
    const root = await stratum.createAbacPolicy(X.id, policy);
    await stratum.createAbacPolicy(Y.id, policy);
    await stratum.createAbacPolicy(Z.id, policy);

    const d = await runDuringMove(X.id, B.id, () => stratum.deleteAbacPolicy(X.id, root.id));

    expect(d.ok).toBe(true);
    const left = await getPool().query(`SELECT 1 FROM abac_policies WHERE name = $1`, [
      policy.name,
    ]);
    expect(left.rows).toHaveLength(0);
  });
});
