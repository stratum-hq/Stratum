import { BaseAdapter } from "../base-adapter.js";
import pg from "pg";

// Minimal interface for Prisma client operations used here.
// Using a structural type avoids a hard runtime dependency on @prisma/client.
interface PrismaClientLike {
  $extends: (extension: unknown) => PrismaClientLike;
  $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<number>;
  $transaction: <T>(fn: (tx: PrismaClientLike) => Promise<T>) => Promise<T>;
}

export class PrismaAdapter extends BaseAdapter {
  constructor(pool: pg.Pool) {
    super(pool);
  }

  withTenant(prisma: PrismaClientLike, contextFn: () => string): PrismaClientLike {
    return prisma.$extends({
      query: {
        $allOperations({ args, query }: { args: unknown; query: (args: unknown) => Promise<unknown> }) {
          const tenantId = contextFn();
          return prisma.$transaction(async (tx: PrismaClientLike) => {
            await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
            return query(args);
          });
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
