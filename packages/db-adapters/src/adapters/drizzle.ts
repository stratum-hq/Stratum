import { BaseAdapter } from "../base-adapter.js";
import pg from "pg";

// Structural type to avoid a hard runtime dependency on drizzle-orm.
// Matches only the subset of the Drizzle API this adapter uses.
export interface DrizzleLike {
  execute(query: unknown): Promise<unknown>;
  transaction<T>(fn: (tx: DrizzleLike) => Promise<T>): Promise<T>;
}

export class DrizzleAdapter extends BaseAdapter {
  constructor(pool: pg.Pool) {
    super(pool);
  }

  /**
   * Returns a wrapper around the given Drizzle instance so that every call to
   * `transaction()` injects `set_config('app.current_tenant_id', ...)` before
   * executing the user's callback.  The `execute()` method is similarly wrapped
   * inside a transaction to guarantee the tenant context and the statement run
   * on the same connection.
   *
   * contextFn should return the current tenant ID (e.g. from AsyncLocalStorage).
   * When contextFn returns an empty string the original methods are forwarded
   * without wrapping.
   */
  withTenantScope(db: DrizzleLike, contextFn: () => string): DrizzleLike {
    const original = db;

    const wrappedTransaction = async <T>(fn: (tx: DrizzleLike) => Promise<T>): Promise<T> => {
      const tenantId = contextFn();
      if (!tenantId) {
        throw new Error(
          "Tenant context is required for database operations. " +
          "Use the unwrapped instance for system/admin operations."
        );
      }
      return original.transaction(async (tx: DrizzleLike) => {
        await tx.execute({
          sql: `SELECT set_config('app.current_tenant_id', $1, true)`,
          params: [tenantId],
        });
        return fn(tx);
      });
    };

    const wrappedExecute = async (query: unknown): Promise<unknown> => {
      const tenantId = contextFn();
      if (!tenantId) {
        throw new Error(
          "Tenant context is required for database operations. " +
          "Use the unwrapped instance for system/admin operations."
        );
      }
      return original.transaction(async (tx: DrizzleLike) => {
        await tx.execute({
          sql: `SELECT set_config('app.current_tenant_id', $1, true)`,
          params: [tenantId],
        });
        return tx.execute(query);
      });
    };

    return {
      execute: wrappedExecute,
      transaction: wrappedTransaction,
    };
  }
}

// Convenience function matching the other adapters' API shape.
export function withTenantScope(
  db: DrizzleLike,
  contextFn: () => string,
  pool: pg.Pool,
): DrizzleLike {
  const adapter = new DrizzleAdapter(pool);
  return adapter.withTenantScope(db, contextFn);
}
