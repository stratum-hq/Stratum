import { validateSlug } from "@stratum-hq/core";
import { tenantSchemaName } from "../schema/manager.js";
import {
  newDatasourceClient,
  type PrismaDatasourceClientClass,
  type PrismaDriverAdapterClientClass,
  type PrismaDriverAdapterOptions,
} from "./prisma-driver-adapter.js";

// Minimal interface for Prisma client operations used here.
// Using a structural type avoids a hard runtime dependency on @prisma/client.
// The adapter calls only `$disconnect`, so the interface holds only that member.
interface PrismaClientLike {
  $disconnect(): Promise<void>;
}

/**
 * Prisma adapter for SCHEMA_PER_TENANT isolation.
 *
 * Prisma schema-qualifies every table with the schema of its connection
 * settings, so `search_path` cannot route its queries. Each tenant therefore
 * gets its own Prisma client whose connection settings name the tenant's
 * schema. Clients are cached per tenant slug, least recently used first out.
 *
 * Prisma 5 and 6 read the schema from the `schema` parameter of the datasource URL:
 *   const adapter = new SchemaPrismaAdapter(PrismaClient, baseUrl);
 *
 * Prisma 7 has no datasource URL option and ignores a `schema` URL parameter.
 * Give the driver adapter class, and the adapter passes it the tenant's schema:
 *   import { PrismaPg } from '@prisma/adapter-pg';
 *   const adapter = new SchemaPrismaAdapter(PrismaClient, baseUrl, { driverAdapter: PrismaPg });
 *
 * Then, with either form:
 *   const prisma = adapter.getClient('acme_corp');
 *   const rows = await prisma.someModel.findMany();
 */
export class SchemaPrismaAdapter<C extends PrismaClientLike = PrismaClientLike, A = unknown> {
  private readonly clients: Map<string, C> = new Map();
  private readonly maxClients: number;
  private readonly createClient: (schemaName: string) => C;

  constructor(PrismaClient: PrismaDatasourceClientClass<C>, baseDatasourceUrl: string, maxClients?: number);
  constructor(
    PrismaClient: PrismaDriverAdapterClientClass<C, A>,
    baseDatasourceUrl: string,
    options: PrismaDriverAdapterOptions<A>,
  );
  constructor(
    PrismaClient: PrismaDatasourceClientClass<C> | PrismaDriverAdapterClientClass<C, A>,
    baseDatasourceUrl: string,
    maxClientsOrOptions: number | PrismaDriverAdapterOptions<A> = 50,
  ) {
    if (typeof maxClientsOrOptions === "number") {
      const Client = PrismaClient as PrismaDatasourceClientClass<C>;
      this.maxClients = maxClientsOrOptions;
      this.createClient = (schemaName) => {
        const url = new URL(baseDatasourceUrl);
        url.searchParams.set("schema", schemaName);
        return newDatasourceClient(Client, url.toString());
      };
    } else {
      const Client = PrismaClient as PrismaDriverAdapterClientClass<C, A>;
      const { driverAdapter: DriverAdapter, maxClients = 50 } = maxClientsOrOptions;
      this.maxClients = maxClients;
      this.createClient = (schemaName) =>
        new Client({
          adapter: new DriverAdapter({ connectionString: baseDatasourceUrl }, { schema: schemaName }),
        });
    }
  }

  /** Returns a Prisma client bound to the tenant's schema. */
  getClient(tenantSlug: string): C {
    const schemaName = tenantSchemaName(validateSlug(tenantSlug));
    const existing = this.clients.get(schemaName);
    if (existing) {
      this.clients.delete(schemaName);
      this.clients.set(schemaName, existing);
      return existing;
    }

    if (this.clients.size >= this.maxClients) {
      const [oldestKey, oldest] = this.clients.entries().next().value as [string, C];
      this.clients.delete(oldestKey);
      void oldest.$disconnect().catch(() => {});
    }

    const client = this.createClient(schemaName);
    this.clients.set(schemaName, client);
    return client;
  }

  /** Disconnects all cached Prisma clients. Call during application shutdown. */
  async disconnectAll(): Promise<void> {
    const clients = Array.from(this.clients.values());
    this.clients.clear();
    await Promise.all(clients.map((client) => client.$disconnect()));
  }
}

/**
 * @deprecated Cannot isolate tenants: Prisma ignores `search_path` and the
 * wrapped query does not run on the transaction that would set it. Always
 * throws. Use `new SchemaPrismaAdapter(PrismaClient, url).getClient(slug)`.
 */
export function withSchemaTenant(
  _prisma: unknown,
  _contextFn: () => string,
): never {
  throw new Error(
    "withSchemaTenant cannot isolate Prisma queries by schema. " +
      "Use new SchemaPrismaAdapter(PrismaClient, datasourceUrl).getClient(tenantSlug) instead.",
  );
}
