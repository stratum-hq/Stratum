import { validateSlug } from "@stratum-hq/core";
import { tenantSchemaName } from "../schema/manager.js";

// Minimal interface for Prisma client operations used here.
// Using a structural type avoids a hard runtime dependency on @prisma/client.
interface PrismaClientLike {
  $extends: (extension: unknown) => PrismaClientLike;
  $disconnect: () => Promise<void>;
}

type PrismaConstructor = new (options: { datasources: { db: { url: string } } }) => PrismaClientLike;

/**
 * Prisma adapter for SCHEMA_PER_TENANT isolation.
 *
 * Prisma schema-qualifies every table with the datasource URL's `schema`
 * parameter, so `search_path` cannot route its queries. Each tenant therefore
 * gets its own Prisma client whose datasource URL names the tenant's schema.
 * Clients are cached per tenant slug, least recently used first out.
 *
 * Usage:
 *   const adapter = new SchemaPrismaAdapter(PrismaClient, baseUrl);
 *   const prisma = adapter.getClient('acme_corp');
 *   const rows = await prisma.someModel.findMany();
 */
export class SchemaPrismaAdapter {
  private readonly clients: Map<string, PrismaClientLike> = new Map();

  constructor(
    private readonly PrismaClient: PrismaConstructor,
    private readonly baseDatasourceUrl: string,
    private readonly maxClients: number = 50,
  ) {}

  /** Returns a Prisma client bound to the tenant's schema. */
  getClient(tenantSlug: string): PrismaClientLike {
    const schemaName = tenantSchemaName(validateSlug(tenantSlug));
    const existing = this.clients.get(schemaName);
    if (existing) {
      this.clients.delete(schemaName);
      this.clients.set(schemaName, existing);
      return existing;
    }

    if (this.clients.size >= this.maxClients) {
      const [oldestKey, oldest] = this.clients.entries().next().value as [string, PrismaClientLike];
      this.clients.delete(oldestKey);
      void oldest.$disconnect().catch(() => {});
    }

    const url = new URL(this.baseDatasourceUrl);
    url.searchParams.set("schema", schemaName);
    const client = new this.PrismaClient({ datasources: { db: { url: url.toString() } } });
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
