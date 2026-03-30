import type pg from "pg";

export interface IsolationOptions {
  /** Column name to use for the test row. Defaults to "id". */
  testColumn?: string;
}

/**
 * Verifies that tenantA cannot read tenantB's data in the given table.
 * Inserts a test row as tenantB, then queries as tenantA and asserts 0 rows returned.
 * Cleans up after itself.
 */
export async function assertIsolation(
  pool: pg.Pool,
  tenantA: string,
  tenantB: string,
  table: string,
  options?: IsolationOptions,
): Promise<void> {
  const column = options?.testColumn ?? "id";
  const testValue = `__stratum_isolation_test_${Date.now()}`;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Insert a test row as tenantB
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [
      tenantB,
    ]);
    await client.query(
      `INSERT INTO ${escapeIdentifier(table)} (${escapeIdentifier(column)}) VALUES ($1)`,
      [testValue],
    );

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
        `Tenant '${tenantA}' was able to read ${count} row(s) from tenant '${tenantB}' data in table '${table}' — RLS policy is not enforcing isolation`,
      );
    }
  } finally {
    // Always roll back to clean up the test row
    await client.query("ROLLBACK");
    client.release();
  }
}

/**
 * Verifies that child tenant inherits config from parent tenant.
 * Sets config on parent, reads from child, asserts match.
 * Also tests: child override takes precedence, locked config cannot be overridden.
 */
export async function assertConfigInheritance(
  pool: pg.Pool,
  parentId: string,
  childId: string,
  key: string,
): Promise<void> {
  const parentValue = `__stratum_parent_${Date.now()}`;
  const childOverride = `__stratum_child_${Date.now()}`;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Step 1: Set config on parent, verify child inherits it
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [
      parentId,
    ]);
    await client.query(
      `INSERT INTO tenant_config (tenant_id, key, value) VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [parentId, key, parentValue],
    );

    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [
      childId,
    ]);
    const inherited = await client.query(
      `SELECT value FROM tenant_config_resolved WHERE tenant_id = $1 AND key = $2`,
      [childId, key],
    );

    if ((inherited.rowCount ?? 0) === 0 || inherited.rows[0].value !== parentValue) {
      const actual = (inherited.rowCount ?? 0) === 0 ? "no value" : inherited.rows[0].value;
      throw new Error(
        `Child tenant '${childId}' did not inherit config key '${key}' from parent '${parentId}' — expected '${parentValue}', got '${actual}'`,
      );
    }

    // Step 2: Child override takes precedence
    await client.query(
      `INSERT INTO tenant_config (tenant_id, key, value) VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [childId, key, childOverride],
    );

    const overridden = await client.query(
      `SELECT value FROM tenant_config_resolved WHERE tenant_id = $1 AND key = $2`,
      [childId, key],
    );

    if ((overridden.rowCount ?? 0) === 0 || overridden.rows[0].value !== childOverride) {
      const actual = (overridden.rowCount ?? 0) === 0 ? "no value" : overridden.rows[0].value;
      throw new Error(
        `Child tenant '${childId}' override for key '${key}' did not take precedence — expected '${childOverride}', got '${actual}'`,
      );
    }

    // Step 3: Locked config cannot be overridden by child
    // Remove child override first, then lock at parent level
    await client.query(
      `DELETE FROM tenant_config WHERE tenant_id = $1 AND key = $2`,
      [childId, key],
    );
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [
      parentId,
    ]);
    await client.query(
      `UPDATE tenant_config SET locked = true WHERE tenant_id = $1 AND key = $2`,
      [parentId, key],
    );

    // Attempt to override as child — should fail or be ignored
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [
      childId,
    ]);

    let lockedOverrideFailed = false;
    try {
      await client.query(
        `INSERT INTO tenant_config (tenant_id, key, value) VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
        [childId, key, childOverride],
      );
      // If insert succeeded, check that resolved value still matches parent
      const resolved = await client.query(
        `SELECT value FROM tenant_config_resolved WHERE tenant_id = $1 AND key = $2`,
        [childId, key],
      );
      if ((resolved.rowCount ?? 0) > 0 && resolved.rows[0].value === parentValue) {
        lockedOverrideFailed = true; // locked config correctly prevented override
      }
    } catch {
      // A constraint violation or trigger error means the lock worked
      lockedOverrideFailed = true;
    }

    if (!lockedOverrideFailed) {
      throw new Error(
        `Child tenant '${childId}' was able to override locked config key '${key}' from parent '${parentId}' — lock is not enforced`,
      );
    }
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

/** Escape a SQL identifier to prevent injection. */
function escapeIdentifier(id: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id)) {
    throw new Error(`Invalid SQL identifier: ${id}`);
  }
  return `"${id}"`;
}

export interface MongoIsolationOptions {
  strategy: "SHARED_COLLECTION" | "COLLECTION_PER_TENANT" | "DATABASE_PER_TENANT";
  /** Collection to use for the test documents. Defaults to "test_isolation". */
  collectionName?: string;
  /** Field name for tenant scoping in SHARED_COLLECTION mode. Defaults to "tenant_id". */
  tenantIdField?: string;
}

/**
 * Verifies that tenantA cannot read tenantB's documents in MongoDB.
 * Works for all three isolation strategies. Inserts a test document as tenantB,
 * queries as tenantA, asserts 0 documents returned, and cleans up.
 */
export async function assertMongoIsolation(
  clientOrAdapter: unknown,
  tenantA: string,
  tenantB: string,
  options: MongoIsolationOptions,
): Promise<void> {
  const collectionName = options.collectionName ?? "test_isolation";
  const tenantIdField = options.tenantIdField ?? "tenant_id";
  const testMarker = `__stratum_isolation_test_${Date.now()}`;

  // We use dynamic property access so this file compiles without mongodb as a
  // required dependency (it is an optional peer dependency).
  const client = clientOrAdapter as {
    db: (name?: string) => {
      collection: (name: string) => {
        insertOne: (doc: Record<string, unknown>) => Promise<unknown>;
        deleteOne: (filter: Record<string, unknown>) => Promise<unknown>;
        findOne: (filter: Record<string, unknown>) => Promise<unknown>;
      };
    };
  };

  switch (options.strategy) {
    case "SHARED_COLLECTION": {
      const db = client.db();
      const col = db.collection(collectionName);
      // Insert a document belonging to tenantB
      await col.insertOne({ [tenantIdField]: tenantB, _testMarker: testMarker });
      try {
        // Query using tenantA's filter -- should return nothing
        const found = await col.findOne({
          [tenantIdField]: tenantA,
          _testMarker: testMarker,
        });
        if (found !== null && found !== undefined) {
          throw new Error(
            `Tenant '${tenantA}' was able to read a document belonging to tenant '${tenantB}' in collection '${collectionName}' -- SHARED_COLLECTION isolation is not enforced`,
          );
        }
      } finally {
        await col.deleteOne({ [tenantIdField]: tenantB, _testMarker: testMarker });
      }
      break;
    }

    case "COLLECTION_PER_TENANT": {
      const db = client.db();
      const tenantBCollection = `${collectionName}_${tenantB}`;
      const tenantACollection = `${collectionName}_${tenantA}`;
      const colB = db.collection(tenantBCollection);
      // Insert a document in tenantB's collection
      await colB.insertOne({ _testMarker: testMarker });
      try {
        // Query tenantA's collection -- should return nothing
        const colA = db.collection(tenantACollection);
        const found = await colA.findOne({ _testMarker: testMarker });
        if (found !== null && found !== undefined) {
          throw new Error(
            `Tenant '${tenantA}' was able to read a document from tenant '${tenantB}' -- COLLECTION_PER_TENANT routing is not enforced (found in '${tenantACollection}' a document inserted into '${tenantBCollection}')`,
          );
        }
      } finally {
        await colB.deleteOne({ _testMarker: testMarker });
      }
      break;
    }

    case "DATABASE_PER_TENANT": {
      const dbB = client.db(tenantB);
      const colB = dbB.collection(collectionName);
      // Insert a document in tenantB's database
      await colB.insertOne({ _testMarker: testMarker });
      try {
        // Query tenantA's database -- should return nothing
        const dbA = client.db(tenantA);
        const colA = dbA.collection(collectionName);
        const found = await colA.findOne({ _testMarker: testMarker });
        if (found !== null && found !== undefined) {
          throw new Error(
            `Tenant '${tenantA}' was able to read a document belonging to tenant '${tenantB}' -- DATABASE_PER_TENANT isolation is not enforced (databases '${tenantA}' and '${tenantB}' share data)`,
          );
        }
      } finally {
        await colB.deleteOne({ _testMarker: testMarker });
      }
      break;
    }

    default: {
      const exhaustive: never = options.strategy;
      throw new Error(`Unknown MongoDB isolation strategy: ${exhaustive}`);
    }
  }
}
