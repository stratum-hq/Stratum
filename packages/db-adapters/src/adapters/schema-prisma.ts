import { tenantSchemaName } from "../schema/manager.js";

// Minimal interface for Prisma client operations used here.
// Using a structural type avoids a hard runtime dependency on @prisma/client.
interface PrismaClientLike {
  $extends: (extension: unknown) => PrismaClientLike;
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<number>;
  $transaction: <T>(fn: (tx: PrismaClientLike) => Promise<T>) => Promise<T>;
}

// Validate slug to prevent SQL injection — slugs follow /^[a-z][a-z0-9_]{0,62}$/
function validateSlug(slug: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(slug)) {
    throw new Error(`Invalid tenant slug: ${slug}`);
  }
  return slug;
}

export class SchemaPrismaAdapter {
  withTenant(
    prisma: PrismaClientLike,
    contextFn: () => string,
  ): PrismaClientLike {
    return prisma.$extends({
      query: {
        $allOperations({
          args,
          query,
        }: {
          args: unknown;
          query: (args: unknown) => Promise<unknown>;
        }) {
          const tenantSlug = validateSlug(contextFn());
          const schemaName = tenantSchemaName(tenantSlug);
          return prisma.$transaction(async (tx: PrismaClientLike) => {
            // schemaName is derived from a validated slug — safe for interpolation.
            await tx.$executeRawUnsafe(
              `SET LOCAL search_path TO ${schemaName}, public`,
            );
            return query(args);
          });
        },
      },
    });
  }
}

export function withSchemaTenant(
  prisma: PrismaClientLike,
  contextFn: () => string,
): PrismaClientLike {
  const adapter = new SchemaPrismaAdapter();
  return adapter.withTenant(prisma, contextFn);
}
