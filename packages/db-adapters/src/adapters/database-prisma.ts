import { DatabasePoolManager } from "../database/pool-manager.js";

// Minimal structural interface — avoids a hard runtime dependency on @prisma/client.
interface PrismaClientLike {
  $extends: (extension: unknown) => PrismaClientLike;
  $executeRaw: (
    query: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<number>;
  $transaction: <T>(fn: (tx: PrismaClientLike) => Promise<T>) => Promise<T>;
  $connect: () => Promise<void>;
  $disconnect: () => Promise<void>;
}

type PrismaConstructor = new (options: { datasources: { db: { url: string } } }) => PrismaClientLike;

/**
 * Prisma adapter for DB_PER_TENANT isolation.
 *
 * Creates a Prisma client instance scoped to the tenant's dedicated database
 * by overriding the datasource URL with the per-tenant database name.
 *
 * Usage:
 *   const adapter = new DatabasePrismaAdapter(poolManager, PrismaClient, baseUrl);
 *   const prisma = adapter.getClient('acme_corp');
 *   const rows = await prisma.someModel.findMany();
 */
export class DatabasePrismaAdapter {
  private readonly clients: Map<string, PrismaClientLike> = new Map();

  constructor(
    private readonly poolManager: DatabasePoolManager,
    private readonly PrismaClient: PrismaConstructor,
    private readonly baseDatasourceUrl: string,
  ) {}

  /**
   * Returns a Prisma client connected to the tenant's dedicated database.
   * Clients are cached per tenant slug; call disconnect() to free resources.
   */
  getClient(tenantSlug: string): PrismaClientLike {
    const existing = this.clients.get(tenantSlug);
    if (existing) return existing;

    const dbName = `stratum_tenant_${tenantSlug}`;
    const tenantUrl = this.buildDatasourceUrl(this.baseDatasourceUrl, dbName);

    const client = new this.PrismaClient({
      datasources: { db: { url: tenantUrl } },
    });

    this.clients.set(tenantSlug, client);
    return client;
  }

  /** Disconnects and removes the cached Prisma client for the given tenant. */
  async disconnectClient(tenantSlug: string): Promise<void> {
    const client = this.clients.get(tenantSlug);
    if (!client) return;
    this.clients.delete(tenantSlug);
    await client.$disconnect();
  }

  /** Disconnects all cached Prisma clients. Call during application shutdown. */
  async disconnectAll(): Promise<void> {
    const entries = Array.from(this.clients.entries());
    this.clients.clear();
    await Promise.all(entries.map(([, client]) => client.$disconnect()));
  }

  /**
   * Replaces the database name in a PostgreSQL connection URL.
   * Handles both connection string formats:
   *   postgres://user:pass@host:port/dbname[?params]
   */
  private buildDatasourceUrl(baseUrl: string, dbName: string): string {
    // Replace the database portion of the URL (last path segment before query string).
    return baseUrl.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`);
  }
}
