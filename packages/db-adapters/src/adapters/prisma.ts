import { BaseAdapter } from "../base-adapter.js";
import pg from "pg";

// Minimal interface for Prisma client operations used here.
// Using a structural type avoids a hard runtime dependency on @prisma/client.
// The members use method syntax on purpose. TypeScript compares method
// parameters bivariantly, so a generated PrismaClient, whose methods take
// narrower argument types, is assignable to this interface.
interface PrismaClientLike {
  $extends(extension: unknown): unknown;
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
  $transaction(queries: unknown[]): Promise<unknown[]>;
}

export class PrismaAdapter extends BaseAdapter {
  constructor(pool: pg.Pool) {
    super(pool);
  }

  withTenant<C extends PrismaClientLike>(prisma: C, contextFn: () => string): C {
    // A query extension adds no models or methods, so the extended client
    // has the type of the client it extends.
    return prisma.$extends({
      query: {
        async $allOperations({ args, query }: { args: unknown; query: (args: unknown) => Promise<unknown> }) {
          const tenantId = contextFn();
          if (!tenantId) {
            throw new Error("Tenant context is required for database operations.");
          }
          // Batch form: Prisma runs both statements in order on one connection
          // inside one transaction. `query(args)` does not inherit an
          // interactive `tx`, so the callback form would run it elsewhere.
          const [, result] = await prisma.$transaction([
            prisma.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`,
            query(args),
          ]);
          return result;
        },
      },
    }) as C;
  }
}

export function withTenant<C extends PrismaClientLike>(
  prisma: C,
  contextFn: () => string,
  pool: pg.Pool,
): C {
  const adapter = new PrismaAdapter(pool);
  return adapter.withTenant(prisma, contextFn);
}
