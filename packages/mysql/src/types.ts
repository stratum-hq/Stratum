// ─── Structural types for MySQL (no hard dependency on mysql2 driver) ───

export interface MysqlConnectionLike {
  query(sql: string, values?: unknown[]): Promise<unknown>;
  execute(sql: string, values?: unknown[]): Promise<unknown>;
  release(): void;
  end(): Promise<void>;
}

export interface MysqlPoolLike {
  getConnection(): Promise<MysqlConnectionLike>;
  query(sql: string, values?: unknown[]): Promise<unknown>;
  end(): Promise<void>;
}

// ─── Adapter interface ───

export interface MysqlAdapter {
  purgeTenantData(tenantSlug: string): Promise<PurgeResult>;
  getStats(): AdapterStats;
}

export interface PurgeResult {
  success: boolean;
  tablesProcessed: number;
  rowsDeleted: number;
  errors: Array<{ table: string; error: Error }>;
}

export interface AdapterStats {
  strategy: string;
  [key: string]: unknown;
}

// ─── Options ───

export interface MysqlSharedAdapterOptions {
  /** The MysqlPoolLike instance to use. */
  pool: MysqlPoolLike;
  /** The database name to use. */
  databaseName: string;
}

export interface MysqlTableAdapterOptions {
  /** The MysqlPoolLike instance to use. */
  pool: MysqlPoolLike;
  /** The database name to use. */
  databaseName: string;
}

export interface MysqlDatabaseAdapterOptions {
  /** Factory function to create a new pool for a connection URI. */
  createPool: (uri: string) => MysqlPoolLike | Promise<MysqlPoolLike>;
  /** Base connection URI (database name will be replaced per-tenant). */
  baseUri: string;
  /** Maximum number of cached pools. Default: 20. */
  maxPools?: number;
  /** Idle timeout in milliseconds. Default: 60000. */
  idleTimeoutMs?: number;
}

export interface MysqlPoolManagerOptions {
  /** Factory function to create a new pool for a connection URI. */
  createPool: (uri: string) => MysqlPoolLike | Promise<MysqlPoolLike>;
  /** Base connection URI. */
  baseUri: string;
  /** Maximum number of cached pools. Default: 20. */
  maxPools?: number;
  /** Idle timeout in milliseconds. Default: 60000. */
  idleTimeoutMs?: number;
}
