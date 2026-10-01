// Type test: the Prisma helpers must accept a real generated PrismaClient
// without a cast, and must keep its model types.
// `npm run typecheck` compiles this file through tsconfig.types.json. It never runs.
//
// The clients come from test-fixtures/, which holds the files that
// `prisma generate` writes for Prisma 5, 6 and 7. See test-fixtures/README.md.
// Prisma 7 has two generators, `prisma-client-js` and `prisma-client`, so the
// Prisma 7 cases run against the output of both.
// The examples come from packages/db-adapters/README.md,
// website/src/content/docs/packages/db-adapters.mdx and the `src/stratum-prisma.ts`
// file that `@stratum-hq/create` generates for its Prisma presets.

import { Pool } from "pg";
import { PrismaClient as PrismaClient5 } from "../../../test-fixtures/prisma-5/client/index.js";
import { PrismaClient as PrismaClient6 } from "../../../test-fixtures/prisma-6/client/index.js";
import { PrismaClient as PrismaClient7 } from "../../../test-fixtures/prisma-7/client/index.js";
import { PrismaClient as PrismaClient7Esm } from "../../../test-fixtures/prisma-7/generated/client.js";
import type { SqlDriverAdapterFactory } from "../../../test-fixtures/prisma-7/client/runtime/client.js";
import {
  DatabasePoolManager,
  DatabasePrismaAdapter,
  PrismaAdapter,
  SchemaPrismaAdapter,
  prismaWithTenant,
} from "@stratum-hq/db-adapters";

declare const pool: Pool;
declare const poolManager: DatabasePoolManager;
declare const currentTenantId: string;

// The constructor of PrismaPg from @prisma/adapter-pg 7.10.0, without its pg types.
declare const PrismaPg: new (
  poolOrConfig: string | { connectionString?: string },
  options?: { schema?: string },
) => SqlDriverAdapterFactory;

export async function prisma5WithTenant() {
  const prisma = new PrismaClient5();
  const tenantPrisma = prismaWithTenant(prisma, () => currentTenantId, pool);
  const orders = await tenantPrisma.order.findMany();
  // @ts-expect-error The scoped client keeps the model types, so an unknown model is an error.
  void tenantPrisma.invoice;
  return orders.map((order) => order.tenantId);
}

export async function prisma6WithTenant() {
  const prisma = new PrismaClient6();
  const tenantPrisma = prismaWithTenant(prisma, () => currentTenantId, pool);
  const orders = await tenantPrisma.order.findMany();
  // @ts-expect-error The scoped client keeps the model types, so an unknown model is an error.
  void tenantPrisma.invoice;
  return orders.map((order) => order.tenantId);
}

export async function prisma5Adapter() {
  const adapter = new PrismaAdapter(pool);
  const tenantPrisma = adapter.withTenant(new PrismaClient5(), () => currentTenantId);
  return tenantPrisma.order.findMany();
}

export async function prisma6Adapter() {
  const adapter = new PrismaAdapter(pool);
  const tenantPrisma = adapter.withTenant(new PrismaClient6(), () => currentTenantId);
  return tenantPrisma.order.findMany();
}

export async function prisma5SchemaAdapter() {
  const adapter = new SchemaPrismaAdapter(PrismaClient5, "postgresql://localhost/app");
  const prisma = adapter.getClient("acme_corp");
  return prisma.order.findMany();
}

export async function prisma6SchemaAdapter() {
  const adapter = new SchemaPrismaAdapter(PrismaClient6, "postgresql://localhost/app");
  const prisma = adapter.getClient("acme_corp");
  return prisma.order.findMany();
}

export async function prisma5DatabaseAdapter() {
  const adapter = new DatabasePrismaAdapter(poolManager, PrismaClient5, "postgresql://localhost/app");
  const prisma = adapter.getClient("acme_corp");
  return prisma.order.findMany();
}

export async function prisma6DatabaseAdapter() {
  const adapter = new DatabasePrismaAdapter(poolManager, PrismaClient6, "postgresql://localhost/app");
  const prisma = adapter.getClient("acme_corp");
  return prisma.order.findMany();
}

export async function prisma7WithTenant() {
  const prisma = new PrismaClient7({ adapter: new PrismaPg({ connectionString: "postgresql://localhost/app" }) });
  const tenantPrisma = prismaWithTenant(prisma, () => currentTenantId, pool);
  const orders = await tenantPrisma.order.findMany();
  // @ts-expect-error The scoped client keeps the model types, so an unknown model is an error.
  void tenantPrisma.invoice;
  return orders.map((order) => order.tenantId);
}

export async function prisma7EsmWithTenant() {
  const prisma = new PrismaClient7Esm({ adapter: new PrismaPg({ connectionString: "postgresql://localhost/app" }) });
  const tenantPrisma = prismaWithTenant(prisma, () => currentTenantId, pool);
  const orders = await tenantPrisma.order.findMany();
  // @ts-expect-error The scoped client keeps the model types, so an unknown model is an error.
  void tenantPrisma.invoice;
  return orders.map((order) => order.tenantId);
}

export async function prisma7SchemaAdapter() {
  const adapter = new SchemaPrismaAdapter(PrismaClient7, "postgresql://localhost/app", {
    driverAdapter: PrismaPg,
  });
  const prisma = adapter.getClient("acme_corp");
  // @ts-expect-error The client keeps the model types, so an unknown model is an error.
  void prisma.invoice;
  return prisma.order.findMany();
}

export async function prisma7EsmSchemaAdapter() {
  const adapter = new SchemaPrismaAdapter(PrismaClient7Esm, "postgresql://localhost/app", {
    driverAdapter: PrismaPg,
    maxClients: 20,
  });
  const prisma = adapter.getClient("acme_corp");
  return prisma.order.findMany();
}

export async function prisma7DatabaseAdapter() {
  const adapter = new DatabasePrismaAdapter(poolManager, PrismaClient7, "postgresql://localhost/app", {
    driverAdapter: PrismaPg,
  });
  const prisma = adapter.getClient("acme_corp");
  // @ts-expect-error The client keeps the model types, so an unknown model is an error.
  void prisma.invoice;
  return prisma.order.findMany();
}

export async function prisma7EsmDatabaseAdapter() {
  const adapter = new DatabasePrismaAdapter(poolManager, PrismaClient7Esm, "postgresql://localhost/app", {
    driverAdapter: PrismaPg,
  });
  const prisma = adapter.getClient("acme_corp");
  return prisma.order.findMany();
}

export function prisma7NeedsDriverAdapter() {
  // @ts-expect-error Prisma 7 has no `datasources` option, so it needs a driver adapter.
  void new SchemaPrismaAdapter(PrismaClient7, "postgresql://localhost/app");
  // @ts-expect-error Prisma 7 has no `datasources` option, so it needs a driver adapter.
  void new DatabasePrismaAdapter(poolManager, PrismaClient7Esm, "postgresql://localhost/app");
}
