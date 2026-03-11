import pg from "pg";
import { BaseAdapter } from "../base-adapter.js";

export class RawAdapter extends BaseAdapter {
  constructor(pool: pg.Pool) {
    super(pool);
  }

  async query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    tenantId: string,
    text: string,
    values?: unknown[],
  ): Promise<pg.QueryResult<T>> {
    return this.executeWithTenantContext(tenantId, (client) =>
      client.query<T>(text, values),
    );
  }
}

export function createTenantPool(
  pool: pg.Pool,
  contextFn: () => string,
): RawAdapter {
  const adapter = new RawAdapter(pool);
  return new Proxy(adapter, {
    get(target, prop) {
      if (prop === "query") {
        return (text: string, values?: unknown[]) =>
          target.query(contextFn(), text, values);
      }
      return (target as unknown as Record<string | symbol, unknown>)[prop];
    },
  }) as RawAdapter;
}
