---
"@stratum-hq/db-adapters": minor
---

Support Prisma 7 in `SchemaPrismaAdapter` and `DatabasePrismaAdapter`. Prisma 7 removed the `datasources` option of the `PrismaClient` constructor and ignores a `schema` parameter in the connection URL. Give the adapters a driver adapter class as a new options argument: `new SchemaPrismaAdapter(PrismaClient, url, { driverAdapter: PrismaPg })` and `new DatabasePrismaAdapter(poolManager, PrismaClient, url, { driverAdapter: PrismaPg })`. Each tenant client then connects through `new PrismaPg({ connectionString }, { schema })`. The Prisma 5 and 6 form is unchanged. The Prisma helpers now support Prisma 5, 6 and 7.
