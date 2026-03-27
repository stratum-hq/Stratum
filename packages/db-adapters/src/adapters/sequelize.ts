import { BaseAdapter } from "../base-adapter.js";
import pg from "pg";

// Structural type to avoid a hard runtime dependency on sequelize.
// Using a minimal interface matching only what this adapter uses.
interface SequelizeLike {
  query(sql: string, options?: Record<string, unknown>): Promise<unknown>;
  transaction<T>(fn: (t: unknown) => Promise<T>): Promise<T>;
  addHook(hookName: string, fn: (...args: unknown[]) => void | Promise<void>): void;
}

const TENANT_HOOKS = [
  "beforeFind",
  "beforeCreate",
  "beforeUpdate",
  "beforeDestroy",
  "beforeBulkCreate",
  "beforeBulkUpdate",
  "beforeBulkDestroy",
] as const;

export class SequelizeAdapter extends BaseAdapter {
  constructor(pool: pg.Pool) {
    super(pool);
  }

  /**
   * Add tenant-scoping hooks to a Sequelize instance.
   * Before each query lifecycle event, sets app.current_tenant_id via
   * set_config so PostgreSQL RLS policies can filter by tenant.
   * contextFn should return the current tenant ID (e.g. from AsyncLocalStorage).
   */
  withTenantScope(sequelize: SequelizeLike, contextFn: () => string): SequelizeLike {
    const setTenantContext = async () => {
      const tenantId = contextFn();
      if (tenantId) {
        await sequelize.query(
          `SELECT set_config('app.current_tenant_id', $1, true)`,
          { bind: [tenantId] },
        );
      }
    };

    for (const hook of TENANT_HOOKS) {
      sequelize.addHook(hook, setTenantContext);
    }

    return sequelize;
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
