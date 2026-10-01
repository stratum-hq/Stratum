import { BaseAdapter } from "../base-adapter.js";
import pg from "pg";

// Structural type to avoid a hard runtime dependency on drizzle-orm.
// Matches only the subset of the Drizzle API this adapter uses.
export interface DrizzleLike {
  execute(query: unknown): Promise<unknown>;
  transaction<T>(fn: (tx: DrizzleLike) => Promise<T>): Promise<T>;
}

// drizzle-orm is an optional peer, so it is loaded only when this adapter runs.
async function setTenantConfig(tx: DrizzleLike, tenantId: string): Promise<void> {
  const { sql } = await import("drizzle-orm");
  await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
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
   * When contextFn returns an empty string, `transaction()` and `execute()`
   * throw instead of running. Use the unwrapped Drizzle instance for system or
   * admin queries that run without a tenant.
   */
  withTenant<D extends DrizzleLike>(
    db: D,
    contextFn: () => string,
  ): Pick<D, "execute" | "transaction"> {
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
        await setTenantConfig(tx, tenantId);
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
        await setTenantConfig(tx, tenantId);
        return tx.execute(query);
      });
    };

    // Typed as the caller's own Drizzle instance so `tx` keeps its query
    // builder (`tx.select()...`) inside `transaction`.
    return {
      execute: wrappedExecute,
      transaction: wrappedTransaction,
    } as unknown as Pick<D, "execute" | "transaction">;
  }
}

// Convenience function matching the other adapters' API shape.
export function withTenant<D extends DrizzleLike>(
  db: D,
  contextFn: () => string,
  pool: pg.Pool,
): Pick<D, "execute" | "transaction"> {
  const adapter = new DrizzleAdapter(pool);
  return adapter.withTenant(db, contextFn);
}

/** @deprecated Use `withTenant` instead. */
export const withTenantScope = withTenant;
