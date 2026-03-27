import { BaseAdapter } from "../base-adapter.js";
import pg from "pg";

// Structural type to avoid a hard runtime dependency on sequelize.
// Using a minimal interface matching only what this adapter uses.
interface SequelizeLike {
  query(sql: string, options?: Record<string, unknown>): Promise<unknown>;
  transaction<T>(fn: (t: unknown) => Promise<T>): Promise<T>;
  addHook(hookName: string, fn: (...args: unknown[]) => void | Promise<void>): void;
}

export class SequelizeAdapter extends BaseAdapter {
  constructor(pool: pg.Pool) {
    super(pool);
  }

  /**
   * Returns a proxy-like object wrapping the given Sequelize instance so that
   * every call to `query()` runs inside a transaction where `set_config` is
   * called first.  This guarantees that the tenant context and the actual query
   * execute on the same connection, preventing RLS context leaks across
   * connection-pool hops.
   *
   * contextFn should return the current tenant ID (e.g. from AsyncLocalStorage).
   * When contextFn returns an empty string the original query is forwarded
   * without wrapping.
   */
  withTenantScope(sequelize: SequelizeLike, contextFn: () => string): SequelizeLike {
    const original = sequelize;

    const wrappedQuery = async (sql: string, options?: Record<string, unknown>) => {
      const tenantId = contextFn();
      if (!tenantId) {
        return original.query(sql, options);
      }
      return original.transaction(async (t: unknown) => {
        await original.query(
          `SELECT set_config('app.current_tenant_id', $1, true)`,
          { bind: [tenantId], transaction: t } as Record<string, unknown>,
        );
        return original.query(sql, { ...options, transaction: t } as Record<string, unknown>);
      });
    };

    return {
      query: wrappedQuery,
      transaction: original.transaction.bind(original),
      addHook: original.addHook.bind(original),
    };
  }
}

// Convenience function matching PrismaAdapter's withTenant API shape.
export function withTenantScope(
  sequelize: SequelizeLike,
  contextFn: () => string,
  pool: pg.Pool,
): SequelizeLike {
  const adapter = new SequelizeAdapter(pool);
  return adapter.withTenantScope(sequelize, contextFn);
}
