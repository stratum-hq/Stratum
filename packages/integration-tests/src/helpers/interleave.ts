import pg from "pg";

/**
 * Deterministic interleaving of real Postgres transactions.
 *
 * A test-only trigger on `tenants` makes any INSERT or UPDATE of a row whose
 * slug starts with {@link GATE_PREFIX} wait on a shared advisory lock. While a
 * test holds that lock exclusively ("closes the gate"), the gated statement
 * stops inside its own transaction, after everything the service did before
 * it and with every lock it already holds. The test then starts a second
 * operation, waits until that operation has either finished or is itself
 * waiting on a lock, and opens the gate.
 */

export const GATE_PREFIX = "a9gate";
const GATE_KEY = 919_191_919;

export async function installGate(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE OR REPLACE FUNCTION a9_test_gate() RETURNS trigger AS $$
    BEGIN
      PERFORM pg_advisory_xact_lock_shared(${GATE_KEY});
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql`);
  await pool.query(`DROP TRIGGER IF EXISTS a9_test_gate ON tenants`);
  await pool.query(`
    CREATE TRIGGER a9_test_gate
      BEFORE INSERT OR UPDATE ON tenants
      FOR EACH ROW
      WHEN (NEW.slug LIKE '${GATE_PREFIX}%')
      EXECUTE FUNCTION a9_test_gate()`);
}

export async function removeGate(pool: pg.Pool): Promise<void> {
  await pool.query(`DROP TRIGGER IF EXISTS a9_test_gate ON tenants`);
  await pool.query(`DROP FUNCTION IF EXISTS a9_test_gate()`);
}

export interface ClosedGate {
  open(): Promise<void>;
}

/** Hold the gate on a dedicated connection until `open()` is called. */
export async function closeGate(connectionString: string): Promise<ClosedGate> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  await client.query(`SELECT pg_advisory_lock(${GATE_KEY})`);
  let opened = false;
  return {
    async open() {
      if (opened) return;
      opened = true;
      await client.query(`SELECT pg_advisory_unlock(${GATE_KEY})`);
      await client.end();
    },
  };
}

export interface Tracked<T> {
  result: Promise<{ ok: true; value: T } | { ok: false; error: unknown }>;
  settled(): boolean;
}

/** Start an operation and remember whether it has finished, without throwing. */
export function track<T>(op: Promise<T>): Tracked<T> {
  let done = false;
  const result = op.then(
    (value) => {
      done = true;
      return { ok: true as const, value };
    },
    (error: unknown) => {
      done = true;
      return { ok: false as const, error };
    },
  );
  return { result, settled: () => done };
}

async function lockWaiters(pool: pg.Pool): Promise<number> {
  const res = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pg_stat_activity
     WHERE datname = current_database() AND wait_event_type = 'Lock'`,
  );
  return res.rows[0].n;
}

/**
 * Wait until at least `count` backends in this database are waiting on a lock,
 * or until `op` (if given) has finished. Throws on timeout.
 */
export async function waitForLockWaiters(
  pool: pg.Pool,
  count: number,
  op?: Tracked<unknown>,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (op?.settled()) return;
    if ((await lockWaiters(pool)) >= count) return;
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${count} lock waiter(s)`);
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

/**
 * Rows among `ids` whose ancestry_path or depth disagree with their parent's.
 * An empty result means the materialized paths match the parent_id chain.
 */
export async function inconsistentPaths(pool: pg.Pool, ids: string[]): Promise<string[]> {
  const res = await pool.query<{ id: string }>(
    `SELECT c.id FROM tenants c
     JOIN tenants p ON p.id = c.parent_id
     WHERE c.id = ANY($1::uuid[])
       AND (c.ancestry_path <> CASE WHEN p.ancestry_path = '/' THEN '/' || p.id
                                    ELSE p.ancestry_path || '/' || p.id END
            OR c.depth <> p.depth + 1)`,
    [ids],
  );
  return res.rows.map((r) => r.id);
}

/** True when following parent_id from any of `ids` revisits a tenant. */
export async function hasParentCycle(pool: pg.Pool, ids: string[]): Promise<boolean> {
  const res = await pool.query<{ id: string; parent_id: string | null }>(
    `SELECT id, parent_id FROM tenants WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  const parentOf = new Map(res.rows.map((r) => [r.id, r.parent_id]));
  for (const start of ids) {
    const seen = new Set<string>();
    let cur: string | null | undefined = start;
    while (cur) {
      if (seen.has(cur)) return true;
      seen.add(cur);
      cur = parentOf.get(cur);
    }
  }
  return false;
}

/** Active tenants among `ids` whose parent is not active. */
export async function activeUnderInactive(pool: pg.Pool, ids: string[]): Promise<string[]> {
  const res = await pool.query<{ id: string }>(
    `SELECT c.id FROM tenants c
     JOIN tenants p ON p.id = c.parent_id
     WHERE c.id = ANY($1::uuid[]) AND c.status = 'active' AND p.status <> 'active'`,
    [ids],
  );
  return res.rows.map((r) => r.id);
}
