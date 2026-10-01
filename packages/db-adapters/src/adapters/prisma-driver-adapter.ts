// Prisma 7 removed the `datasources` constructor option. A Prisma 7 client
// connects through a driver adapter, such as PrismaPg from @prisma/adapter-pg,
// and the driver adapter holds the connection string and the schema.
// The types are structural, so this package needs no Prisma dependency.

/**
 * A driver adapter class with the constructor of PrismaPg from @prisma/adapter-pg:
 * `new PrismaPg(config, { schema })`.
 */
export type PrismaDriverAdapterClass<A> = new (
  config: { connectionString: string },
  options: { schema?: string },
) => A;

/**
 * Options for a Prisma client that connects through a driver adapter.
 * Prisma 7 requires a driver adapter. Prisma 5 and 6 can use the datasource URL instead.
 */
export interface PrismaDriverAdapterOptions<A> {
  /** The driver adapter class, for example `PrismaPg` from `@prisma/adapter-pg`. */
  driverAdapter: PrismaDriverAdapterClass<A>;
  /** The maximum number of cached tenant clients. The default is 50. */
  maxClients?: number;
}

/** A PrismaClient class that takes a datasource URL (Prisma 5 and 6). */
export type PrismaDatasourceClientClass<C> = new (options: { datasources: { db: { url: string } } }) => C;

/** A PrismaClient class that takes a driver adapter (Prisma 7). */
export type PrismaDriverAdapterClientClass<C, A> = new (options: { adapter: A }) => C;

/**
 * Returns a client made with the Prisma 5 and 6 `datasources` option.
 * Prisma 7 rejects that option. Its error does not name the fix, so this
 * function replaces that error with one that names the `driverAdapter` option.
 */
export function newDatasourceClient<C>(PrismaClient: PrismaDatasourceClientClass<C>, url: string): C {
  try {
    return new PrismaClient({ datasources: { db: { url } } });
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unknown property datasources")) {
      throw new Error(
        "This PrismaClient does not accept the `datasources` option, which Prisma 7 removed. " +
          "Pass a driver adapter class as the last argument, for example { driverAdapter: PrismaPg } " +
          "with PrismaPg from @prisma/adapter-pg.",
        { cause: err },
      );
    }
    throw err;
  }
}
