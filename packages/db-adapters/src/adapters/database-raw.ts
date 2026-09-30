import pg from "pg";
import { DatabasePoolManager } from "../database/pool-manager.js";

/**
 * Raw SQL adapter for DB_PER_TENANT isolation.
 *
 * Each query is routed to the dedicated database for the given tenant slug
 * by obtaining a connection from the tenant's pool via DatabasePoolManager.
 * Each method releases its hold on the pool when it finishes, so the manager
 * can evict the pool while no query uses it.
 */
export class DatabaseRawAdapter {
  constructor(private readonly poolManager: DatabasePoolManager) {}

  /**
   * Executes a single query against the tenant's dedicated database.
   * The connection is acquired and released automatically.
   */
  async query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    tenantSlug: string,
    text: string,
    values?: unknown[],
  ): Promise<pg.QueryResult<T>> {
    const pool = await this.poolManager.getPool(tenantSlug);
    try {
      const client = await pool.connect();
      try {
        return await client.query<T>(text, values);
      } finally {
        client.release();
      }
    } finally {
      this.poolManager.releasePool(tenantSlug);
    }
  }

  /**
   * Executes a callback inside an explicit transaction against the tenant's dedicated database.
   * The transaction is automatically committed on success and rolled back on error.
   */
  async executeWithTenantContext<T>(
    tenantSlug: string,
    queryFn: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const pool = await this.poolManager.getPool(tenantSlug);
    try {
      const client = await pool.connect();
      // A failed ROLLBACK must not replace the caller's error. That error goes
      // to client.release instead: a truthy argument makes pg-pool destroy the
      // connection, so no later caller gets a connection in an unknown
      // transaction state.
      let releaseErr: Error | undefined;
      try {
        await client.query("BEGIN");
        const result = await queryFn(client);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackErr) {
          releaseErr =
            rollbackErr instanceof Error ? rollbackErr : new Error(String(rollbackErr));
        }
        throw err;
      } finally {
        client.release(releaseErr);
      }
    } finally {
      this.poolManager.releasePool(tenantSlug);
    }
  }
}
