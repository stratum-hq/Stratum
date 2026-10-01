import type pg from "pg";

/**
 * The search path of the catalog queries that Stratum runs as a privileged
 * login: a superuser, the admin login of adminPool, or the login that runs
 * the migrations. PostgreSQL never looks up functions or operators in
 * pg_temp, so with this path every unqualified function, operator and type
 * resolves in pg_catalog only, and nothing another role created in a schema
 * of the caller's search path is chosen in place of a built-in. Queries that
 * run under it name Stratum objects with their schema.
 */
export const PINNED_SEARCH_PATH = "pg_catalog, pg_temp";

/**
 * Runs `fn` in a transaction on one connection of `pool` whose search_path is
 * {@link PINNED_SEARCH_PATH} for that transaction. It commits when `fn`
 * resolves and rolls back when it throws.
 */
export async function withPinnedSearchPath<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL search_path = ${PINNED_SEARCH_PATH}`);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Runs one query with the search path pinned; see {@link withPinnedSearchPath}. */
export function pinnedQuery<R extends pg.QueryResultRow = pg.QueryResultRow>(
  pool: pg.Pool,
  text: string,
  values?: unknown[],
): Promise<pg.QueryResult<R>> {
  return withPinnedSearchPath(pool, (client) => client.query<R>(text, values));
}

/**
 * The schema in which the search path of `db` finds the table `table`
 * (default tenants), or null when it finds none. Call it on the caller's
 * search path, before pinning it. Its query names every function, operator
 * and type with pg_catalog, so it resolves nothing else through that path.
 */
export async function schemaOfTable(db: pg.Pool | pg.PoolClient, table = "tenants"): Promise<string | null> {
  const res = await db.query<{ nsp: string }>(
    `SELECT n.nspname::pg_catalog.text AS nsp
       FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid OPERATOR(pg_catalog.=) c.relnamespace
      WHERE c.oid OPERATOR(pg_catalog.=) pg_catalog.to_regclass($1::pg_catalog.text)::pg_catalog.oid`,
    [table],
  );
  return res.rows[0]?.nsp ?? null;
}

/** A SQL identifier, quoted. */
export function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
