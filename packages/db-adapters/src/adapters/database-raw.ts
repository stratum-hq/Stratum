import pg from "pg";
import { DatabasePoolManager } from "../database/pool-manager.js";

/**
 * Raw SQL adapter for DB_PER_TENANT isolation.
 *
 * Each query is routed to the dedicated database for the given tenant slug
 * by obtaining a connection from the tenant's pool via DatabasePoolManager.
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
    const pool = this.poolManager.getPool(tenantSlug);
    const client = await pool.connect();
    try {
      return await client.query<T>(text, values);
    } finally {
      client.release();
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
    const pool = this.poolManager.getPool(tenantSlug);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await queryFn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
