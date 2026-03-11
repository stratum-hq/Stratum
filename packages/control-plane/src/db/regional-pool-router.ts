import pg from "pg";

export interface RegionalPoolRouter {
  getPool(regionId: string): pg.Pool;
  getGlobalPool(): pg.Pool;
  registerPool(regionId: string, pool: pg.Pool): void;
  close(): Promise<void>;
}

export function createRegionalPoolRouter(globalPool: pg.Pool): RegionalPoolRouter {
  const pools = new Map<string, pg.Pool>();

  return {
    getPool(regionId: string): pg.Pool {
      const pool = pools.get(regionId);
      if (!pool) {
        // Fall back to global pool if region-specific pool not registered
        return globalPool;
      }
      return pool;
    },
    getGlobalPool(): pg.Pool {
      return globalPool;
    },
    registerPool(regionId: string, pool: pg.Pool): void {
      pools.set(regionId, pool);
    },
    async close(): Promise<void> {
      const closePromises = Array.from(pools.values()).map(p => p.end());
      await Promise.all(closePromises);
      pools.clear();
    },
  };
}
