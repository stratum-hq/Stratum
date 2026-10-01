import { DatabasePoolManager } from "../database/pool-manager.js";
import { getDatabaseName } from "../database/manager.js";
import type {
  PrismaDatasourceClientClass,
  PrismaDriverAdapterClientClass,
  PrismaDriverAdapterOptions,
} from "./prisma-driver-adapter.js";

// Minimal structural interface; avoids a hard runtime dependency on @prisma/client.
// The adapter calls only `$disconnect`, so the interface holds only that member.
interface PrismaClientLike {
  $disconnect(): Promise<void>;
}

/**
 * Prisma adapter for DB_PER_TENANT isolation.
 *
 * Creates a Prisma client instance scoped to the tenant's dedicated database
 * by overriding the datasource URL with the per-tenant database name.
 *
 * Prisma 5 and 6 take the datasource URL:
 *   const adapter = new DatabasePrismaAdapter(poolManager, PrismaClient, baseUrl);
 *
 * Prisma 7 has no datasource URL option. Give the driver adapter class, and the
 * adapter passes it the tenant database URL:
 *   import { PrismaPg } from '@prisma/adapter-pg';
 *   const adapter = new DatabasePrismaAdapter(poolManager, PrismaClient, baseUrl, { driverAdapter: PrismaPg });
 *
 * Then, with either form:
 *   const prisma = adapter.getClient('acme_corp');
 *   const rows = await prisma.someModel.findMany();
 */
export class DatabasePrismaAdapter<C extends PrismaClientLike = PrismaClientLike, A = unknown> {
  private readonly clients: Map<string, C> = new Map();
  private readonly maxClients: number;
  private readonly createClient: (tenantUrl: string) => C;

  constructor(
    poolManager: DatabasePoolManager,
    PrismaClient: PrismaDatasourceClientClass<C>,
    baseDatasourceUrl: string,
    maxClients?: number,
  );
  constructor(
    poolManager: DatabasePoolManager,
    PrismaClient: PrismaDriverAdapterClientClass<C, A>,
    baseDatasourceUrl: string,
    options: PrismaDriverAdapterOptions<A>,
  );
  constructor(
    private readonly poolManager: DatabasePoolManager,
    PrismaClient: PrismaDatasourceClientClass<C> | PrismaDriverAdapterClientClass<C, A>,
    private readonly baseDatasourceUrl: string,
    maxClientsOrOptions: number | PrismaDriverAdapterOptions<A> = 50,
  ) {
    if (typeof maxClientsOrOptions === "number") {
      const Client = PrismaClient as PrismaDatasourceClientClass<C>;
      this.maxClients = maxClientsOrOptions;
      this.createClient = (url) => new Client({ datasources: { db: { url } } });
    } else {
      const Client = PrismaClient as PrismaDriverAdapterClientClass<C, A>;
      const { driverAdapter: DriverAdapter, maxClients = 50 } = maxClientsOrOptions;
      this.maxClients = maxClients;
      // Prisma 5 and 6 read the schema from the `schema` URL parameter. A driver
      // adapter ignores that parameter and takes the schema as an option.
      const schema = new URL(baseDatasourceUrl).searchParams.get("schema") ?? undefined;
      this.createClient = (url) => new Client({ adapter: new DriverAdapter({ connectionString: url }, { schema }) });
    }
  }

  /**
   * Returns a Prisma client connected to the tenant's dedicated database.
   * Clients are cached per tenant slug, up to maxClients; the least recently
   * used client is disconnected when the limit is reached.
   */
  getClient(tenantSlug: string): C {
    const dbName = getDatabaseName(tenantSlug);
    const existing = this.clients.get(tenantSlug);
    if (existing) {
      this.clients.delete(tenantSlug);
      this.clients.set(tenantSlug, existing);
      return existing;
    }

    if (this.clients.size >= this.maxClients) {
      const [oldestKey, oldest] = this.clients.entries().next().value as [string, C];
      this.clients.delete(oldestKey);
      void oldest.$disconnect().catch(() => {});
    }

    const tenantUrl = this.buildDatasourceUrl(this.baseDatasourceUrl, dbName);

    const client = this.createClient(tenantUrl);

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
    const url = new URL(baseUrl);
    url.pathname = `/${dbName}`;
    return url.toString();
  }
}
