import type pg from "pg";
import type { PGliteInterface, PGliteOptions, Results } from "@electric-sql/pglite" with { "resolution-mode": "import" };

// This module runs in the browser as well as in Node. It must not import
// Node-only modules, and it imports PGlite itself only when it must create
// the instance.

/**
 * A `pg.Pool`-compatible object over one PGlite instance.
 *
 * Only these members work: `query`, `connect` (a client with `query` and
 * `release`), `end` and `on`. Other `pg.Pool` members are undefined.
 */
export type PglitePool = pg.Pool & {
  /** The PGlite instance that runs every query of this pool. */
  readonly pglite: PGliteInterface;
};

export interface RestrictedPoolOptions {
  /**
   * The name of the role. It must match `^[a-z_][a-z0-9_]{0,62}$`.
   * Defaults to `stratum_app`.
   */
  role?: string;
}

type QueryConfig = { text: string; values?: unknown[] };

// pg returns int8 and numeric values as strings, because a JavaScript number
// loses precision above 2^53. PGlite returns numbers, so these parsers
// restore the pg behavior.
const PG_PARSERS = { 20: (value: string) => value, 1700: (value: string) => value };

const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

// A restricted pool must share the lock of its source pool, because both
// use the same connection.
const locks = new WeakMap<PglitePool, () => Promise<() => void>>();

/**
 * Return a lock that gives one holder at a time the connection, in request order.
 */
function createLock(): () => Promise<() => void> {
  let tail: Promise<void> = Promise.resolve();
  return () => {
    let unlock!: () => void;
    const held = new Promise<void>((resolve) => (unlock = resolve));
    const acquired = tail.then(() => unlock);
    tail = tail.then(() => held);
    return acquired;
  };
}

// pg sends a plain object as JSON text for every parameter type. PGlite
// serializes by the inferred parameter type and rejects an object for a text
// parameter, so the conversion happens here.
function prepareValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (
    value !== null &&
    typeof value === "object" &&
    !(value instanceof Date) &&
    !(value instanceof Uint8Array) &&
    !Array.isArray(value)
  ) {
    return JSON.stringify(value);
  }
  return value;
}

function toQueryResult(result: Results): pg.QueryResult {
  // PGlite reports affectedRows 0 for a SELECT. pg reports the number of rows
  // for any statement that returns rows.
  const rowCount = result.fields.length > 0 ? result.rows.length : (result.affectedRows ?? 0);
  return { rows: result.rows, rowCount, fields: result.fields } as unknown as pg.QueryResult;
}

async function run(
  db: PGliteInterface,
  textOrConfig: string | QueryConfig,
  values?: unknown[],
): Promise<pg.QueryResult> {
  const text = typeof textOrConfig === "string" ? textOrConfig : textOrConfig.text;
  const params = values ?? (typeof textOrConfig === "string" ? undefined : textOrConfig.values);
  if (!params || params.length === 0) {
    // pg uses the simple query protocol when there are no parameters, and
    // that protocol accepts several statements, as migration files hold.
    // PGlite exec() is the same protocol. It returns one result per statement,
    // and pg returns the last one.
    const results = await db.exec(text, { parsers: PG_PARSERS });
    return toQueryResult(results[results.length - 1] ?? { rows: [], fields: [] });
  }
  return toQueryResult(await db.query(text, params.map(prepareValue), { parsers: PG_PARSERS }));
}

function makePool(
  db: PGliteInterface,
  acquire: () => Promise<() => void>,
  ownsInstance: boolean,
  role: string | null,
): PglitePool {
  const connect = async () => {
    const unlock = await acquire();
    try {
      if (role) await db.exec(`SET ROLE "${role}"`);
    } catch (err) {
      unlock();
      throw err;
    }
    let released = false;
    return {
      query: (textOrConfig: string | QueryConfig, values?: unknown[]) => run(db, textOrConfig, values),
      // pg gives each client its own session and destroys the connection when
      // release() receives an error. This pool has one session for every
      // client, so release cleans it instead: it rolls back a transaction the
      // client left open, and resets the settings and the role the client
      // set. The lock stays held until the cleanup ends, so the next client
      // gets a clean session.
      release: () => {
        if (released) return;
        released = true;
        // RESET ALL leaves the role alone, so RESET ROLE follows it.
        db.exec("ROLLBACK; RESET ALL; RESET ROLE").then(unlock, unlock);
      },
    };
  };

  const pool = {
    pglite: db,
    connect,
    async query(textOrConfig: string | QueryConfig, values?: unknown[]) {
      const client = await connect();
      try {
        return await client.query(textOrConfig, values);
      } finally {
        client.release();
      }
    },
    async end() {
      if (ownsInstance && !db.closed) await db.close();
    },
    on() {
      return pool;
    },
  };
  const result = pool as unknown as PglitePool;
  locks.set(result, acquire);
  return result;
}

function isPglite(value: unknown): value is PGliteInterface {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as PGliteInterface).exec === "function" &&
    typeof (value as PGliteInterface).query === "function"
  );
}

/**
 * Return a `pg.Pool`-compatible pool that runs every query on one PGlite instance.
 *
 * The pool has one connection. A client from `connect()` holds it until
 * `release()`, and other callers wait in order. `release()` rolls back a
 * transaction the client left open and resets the session settings, so the
 * next client does not inherit them. Queries run as the PGlite
 * superuser, so row-level security does not apply; use
 * {@link createRestrictedPool} for that.
 *
 * @param source - A PGlite instance, or options to create one. When the
 *   pool creates the instance, it loads the `ltree` and `uuid_ossp`
 *   extensions, and `end()` closes the instance. When you pass an instance,
 *   you load the extensions and you close it.
 * @returns The pool, after PGlite is ready.
 */
export async function createPglitePool(source?: PGliteInterface | PGliteOptions): Promise<PglitePool> {
  if (isPglite(source)) {
    await source.waitReady;
    return makePool(source, createLock(), false, null);
  }
  const [{ PGlite }, { ltree }, { uuid_ossp }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("@electric-sql/pglite/contrib/ltree"),
    import("@electric-sql/pglite/contrib/uuid_ossp"),
  ]);
  const options = source ?? {};
  const db = await PGlite.create({
    ...options,
    extensions: { ltree, uuid_ossp, ...options.extensions },
  });
  return makePool(db, createLock(), true, null);
}

/**
 * Return a pool that runs every query as a role that is not a superuser, so
 * that row-level security applies.
 *
 * The function creates the role when it does not exist, with NOSUPERUSER and
 * NOBYPASSRLS. It grants the role SELECT, INSERT, UPDATE and DELETE on every
 * table in the `public` schema, and usage of every sequence. Default
 * privileges extend these grants to tables that the current user creates
 * later.
 *
 * The returned pool shares the connection and the lock of `pool`. Each client
 * runs `SET ROLE` when it gets the connection and `RESET ROLE` at release.
 * Its `end()` closes nothing; end the source pool instead.
 *
 * The restricted role is a convenience for tests and demos, not a security
 * boundary: any query can leave it with `RESET ROLE`, because the session
 * belongs to the superuser.
 *
 * @param pool - A pool from {@link createPglitePool} that runs as the superuser.
 * @param options - The role name.
 * @throws Error - The role name is not a plain lowercase identifier.
 */
export async function createRestrictedPool(
  pool: PglitePool,
  options: RestrictedPoolOptions = {},
): Promise<PglitePool> {
  const role = options.role ?? "stratum_app";
  if (!ROLE_NAME.test(role)) {
    throw new Error(`Invalid role name '${role}': use lowercase letters, digits and underscores`);
  }
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
        CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOBYPASSRLS;
      END IF;
    END $$;
    GRANT USAGE ON SCHEMA public TO "${role}";
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${role}";
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${role}";
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${role}";
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO "${role}";
  `);
  const acquire = locks.get(pool);
  if (!acquire) throw new Error("createRestrictedPool needs a pool from createPglitePool");
  return makePool(pool.pglite, acquire, false, role);
}
