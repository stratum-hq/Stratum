---
"@stratum-hq/db-adapters": patch
---

The Prisma helpers now accept a generated `PrismaClient` from Prisma 5 and Prisma 6 without a cast. Before, `prismaWithTenant(prisma, ...)` failed to compile with TS2345, so the Prisma presets of `@stratum-hq/create` failed `next build` and `tsc`. `prismaWithTenant`, `PrismaAdapter.withTenant`, `SchemaPrismaAdapter.getClient` and `DatabasePrismaAdapter.getClient` now return the type of your client, so calls such as `tenantPrisma.order.findMany()` are type-checked. Runtime behavior does not change.
