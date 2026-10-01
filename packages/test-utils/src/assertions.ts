import { randomUUID } from "node:crypto";
import type pg from "pg";

export interface IsolationOptions {
  /**
   * Column that receives the test marker. Defaults to "id". The marker is a
   * random UUID, so it fits UUID and text columns.
   */
  testColumn?: string;
  /** Column holding the owning tenant. Defaults to "tenant_id". */
  tenantColumn?: string;
}

/**
 * Verifies that tenantA cannot read tenantB's data in the given table.
 *
 * Inserts a test row as tenantB (setting `tenantColumn` to tenantB), checks
 * that tenantB can read it back (positive control, so a policy that hides
 * every row cannot pass), then queries as tenantA and asserts 0 rows.
 * Everything runs in one transaction that is rolled back.
 *
 * Connect `pool` as the role your application uses: a superuser or BYPASSRLS
 * role ignores RLS, and the check then fails as it should.
 */
export async function assertIsolation(
  pool: pg.Pool,
  tenantA: string,
  tenantB: string,
  table: string,
  options?: IsolationOptions,
): Promise<void> {
  const column = options?.testColumn ?? "id";
  const tenantColumn = options?.tenantColumn ?? "tenant_id";
  const testValue = randomUUID();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Insert a test row as tenantB
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [
      tenantB,
    ]);
    await client.query(
      `INSERT INTO ${escapeIdentifier(table)} (${escapeIdentifier(tenantColumn)}, ${escapeIdentifier(column)}) VALUES ($1, $2)`,
      [tenantB, testValue],
    );

    // Positive control: tenantB must see its own row, or the check proves nothing
    const own = await client.query(
      `SELECT 1 FROM ${escapeIdentifier(table)} WHERE ${escapeIdentifier(column)} = $1`,
      [testValue],
    );
    if ((own.rowCount ?? 0) !== 1) {
      throw new Error(
        `Tenant '${tenantB}' could not read back its own test row in table '${table}' -- the isolation check is inconclusive (positive control failed)`,
      );
    }

    // Switch to tenantA and attempt to read tenantB's row
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [
      tenantA,
    ]);
    const result = await client.query(
      `SELECT * FROM ${escapeIdentifier(table)} WHERE ${escapeIdentifier(column)} = $1`,
      [testValue],
    );

    const count = result.rowCount ?? 0;
    if (count !== 0) {
      throw new Error(
        `Tenant '${tenantA}' was able to read ${count} row(s) from tenant '${tenantB}' data in table '${table}'. RLS policy is not enforcing isolation`,
      );
    }
  } finally {
    // Always roll back to clean up the test row
    await client.query("ROLLBACK");
    client.release();
  }
}

/**
 * The part of a Stratum instance (`new Stratum({ pool })` from
 * `@stratum-hq/lib`) that assertConfigInheritance uses.
 */
export interface ConfigInheritanceTarget {
  setConfig(tenantId: string, key: string, input: { value: unknown; locked?: boolean }): Promise<unknown>;
  deleteConfig(tenantId: string, key: string): Promise<unknown>;
  resolveConfig(tenantId: string): Promise<Record<string, { value: unknown } | undefined>>;
}

function isConfigLockedError(err: unknown): boolean {
  const e = err as { code?: unknown; name?: unknown } | null;
  return e?.code === "CONFIG_LOCKED" || e?.name === "ConfigLockedError";
}

/**
 * Verifies config inheritance through Stratum's own config API: a value set on
 * the parent resolves on the child, a child override takes precedence, and a
 * key the parent locks cannot be overridden by the child (the override must be
 * rejected with ConfigLockedError; any other error fails the assertion).
 *
 * Writes `key` on both tenants and deletes it again afterwards, so pass a key
 * that is not otherwise in use.
 */
export async function assertConfigInheritance(
  stratum: ConfigInheritanceTarget,
  parentId: string,
  childId: string,
  key: string,
): Promise<void> {
  if (typeof stratum?.setConfig !== "function" || typeof stratum?.resolveConfig !== "function") {
    throw new TypeError(
      "assertConfigInheritance expects a Stratum instance (new Stratum({ pool }) from @stratum-hq/lib).",
    );
  }
  const existing = (await stratum.resolveConfig(childId))[key];
  if (existing !== undefined) {
    throw new Error(
      `Config key '${key}' already resolves for tenant '${childId}' -- pass a key that is not in use`,
    );
  }

  const parentValue = `__stratum_parent_${Date.now()}`;
  const childOverride = `__stratum_child_${Date.now()}`;
  let parentWritten = false;
  let childWritten = false;

  try {
    // Step 1: Set config on parent, verify child inherits it
    await stratum.setConfig(parentId, key, { value: parentValue });
    parentWritten = true;
    const inherited = (await stratum.resolveConfig(childId))[key];
    if (inherited?.value !== parentValue) {
      throw new Error(
        `Child tenant '${childId}' did not inherit config key '${key}' from parent '${parentId}'. Expected '${parentValue}', got '${inherited === undefined ? "no value" : String(inherited.value)}'`,
      );
    }

    // Step 2: Child override takes precedence
    await stratum.setConfig(childId, key, { value: childOverride });
    childWritten = true;
    const overridden = (await stratum.resolveConfig(childId))[key];
    if (overridden?.value !== childOverride) {
      throw new Error(
        `Child tenant '${childId}' override for key '${key}' did not take precedence. Expected '${childOverride}', got '${overridden === undefined ? "no value" : String(overridden.value)}'`,
      );
    }

    // Step 3: Locked config cannot be overridden by child
    await stratum.deleteConfig(childId, key);
    childWritten = false;
    await stratum.setConfig(parentId, key, { value: parentValue, locked: true });

    let rejectedByLock = false;
    try {
      await stratum.setConfig(childId, key, { value: childOverride });
      childWritten = true;
    } catch (err) {
      // Only the lock itself counts. Any other failure is not evidence.
      if (!isConfigLockedError(err)) throw err;
      rejectedByLock = true;
    }
    const resolved = (await stratum.resolveConfig(childId))[key];
    if (!rejectedByLock || resolved?.value !== parentValue) {
      throw new Error(
        `Child tenant '${childId}' was able to override locked config key '${key}' from parent '${parentId}'. The lock is not enforced`,
      );
    }
  } finally {
    if (childWritten) await stratum.deleteConfig(childId, key).catch(() => undefined);
    if (parentWritten) await stratum.deleteConfig(parentId, key).catch(() => undefined);
  }
}

/** Escape a SQL identifier to prevent injection. */
function escapeIdentifier(id: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id)) {
    throw new Error(`Invalid SQL identifier: ${id}`);
  }
  return `"${id}"`;
}

/** The minimal collection surface assertMongoIsolation needs. */
export interface MongoIsolationCollection {
  insertOne(doc: Record<string, unknown>): Promise<unknown>;
  findOne(filter: Record<string, unknown>): Promise<unknown>;
  deleteOne(filter: Record<string, unknown>): Promise<unknown>;
}

/**
 * Returns the collection your application uses for a tenant, through the
 * Stratum data path under test (e.g. `MongoSharedAdapter.scopedCollection`,
 * `MongoCollectionAdapter.scopedCollection`, a collection from
 * `MongoDatabaseAdapter.getDatabase`, or a wrapper that runs a Mongoose model
 * with `stratumPlugin` inside the tenant's context).
 */
export type MongoTenantCollectionAccessor = (
  tenantId: string,
) => MongoIsolationCollection | Promise<MongoIsolationCollection>;

export interface MongoIsolationOptions {
  /** Isolation strategy under test. Used only in failure messages. */
  strategy?: "SHARED_COLLECTION" | "COLLECTION_PER_TENANT" | "DATABASE_PER_TENANT";
}

/**
 * Verifies that tenantA cannot read tenantB's documents in MongoDB, through
 * the data path your application actually uses.
 *
 * Inserts a test document through `getCollection(tenantB)`, checks that tenantB
 * can read it back through the same accessor (positive control), checks that
 * `getCollection(tenantA)` cannot read it, and cleans up. The document carries a
 * `_testMarker` field, so a Mongoose schema under test must be able to store it.
 */
export async function assertMongoIsolation(
  getCollection: MongoTenantCollectionAccessor,
  tenantA: string,
  tenantB: string,
  options: MongoIsolationOptions = {},
): Promise<void> {
  if (typeof getCollection !== "function") {
    throw new TypeError(
      "assertMongoIsolation expects a function that returns the tenant-scoped collection for a tenant id, so the check runs through your Stratum adapter or plugin.",
    );
  }
  if (tenantA === tenantB) {
    throw new Error("assertMongoIsolation needs two different tenants");
  }

  const strategy = options.strategy ?? "tenant";
  const testMarker = `__stratum_isolation_test_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const colB = await getCollection(tenantB);
  const colA = await getCollection(tenantA);

  await colB.insertOne({ _testMarker: testMarker });
  try {
    const own = await colB.findOne({ _testMarker: testMarker });
    if (own === null || own === undefined) {
      throw new Error(
        `Tenant '${tenantB}' could not read back its own test document -- the ${strategy} isolation check is inconclusive (positive control failed)`,
      );
    }

    const found = await colA.findOne({ _testMarker: testMarker });
    if (found !== null && found !== undefined) {
      throw new Error(
        `Tenant '${tenantA}' was able to read a document belonging to tenant '${tenantB}' -- ${strategy} isolation is not enforced`,
      );
    }
  } finally {
    await colB.deleteOne({ _testMarker: testMarker });
  }
}
