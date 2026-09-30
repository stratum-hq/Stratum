import { BaseAdapter } from "../base-adapter.js";
import pg from "pg";

// Minimal interface for Prisma client operations used here.
// Using a structural type avoids a hard runtime dependency on @prisma/client.
interface PrismaClientLike {
  $extends: (extension: unknown) => PrismaClientLike;
  $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<number>;
  $transaction: (queries: unknown[]) => Promise<unknown[]>;
}

export class PrismaAdapter extends BaseAdapter {
  constructor(pool: pg.Pool) {
    super(pool);
  }

  withTenant(prisma: PrismaClientLike, contextFn: () => string): PrismaClientLike {
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
    });
  }
}

export function withTenant(
  prisma: PrismaClientLike,
  contextFn: () => string,
  pool: pg.Pool,
): PrismaClientLike {
  const adapter = new PrismaAdapter(pool);
  return adapter.withTenant(prisma, contextFn);
}
