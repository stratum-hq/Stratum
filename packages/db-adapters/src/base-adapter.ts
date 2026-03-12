import pg from "pg";

export abstract class BaseAdapter {
  protected pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async executeWithTenantContext<T>(
    tenantId: string,
    queryFn: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
      const result = await queryFn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      try { await client.query("RESET app.current_tenant_id"); } catch { /* connection already broken */ }
      client.release();
    }
  }
}
