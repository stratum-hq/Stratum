import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type pg from "pg";
import { withSchemaTenant, SchemaPrismaAdapter, tenantSchemaName } from "@stratum-hq/db-adapters";
import { getPool, closePool } from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";
import { PrismaStandIn } from "./helpers/prisma-standin.js";

/**
 * Schema-per-tenant Prisma routing against real Postgres, through a Prisma
 * stand-in that reproduces Prisma 5's connection behavior and its
 * schema-qualified table names (see helpers/prisma-standin.ts).
 */

const URL = process.env.DATABASE_URL ||
  "postgresql://stratum_test:stratum_test@localhost:5433/stratum_test";

let admin: pg.Pool;
const slugA = uniqueSlug("sp_a");
const slugB = uniqueSlug("sp_b");
const clients: { $disconnect(): Promise<void> }[] = [];

async function count(schema: string): Promise<number> {
  const r = await admin.query<{ n: string }>(`SELECT count(*)::text AS n FROM "${schema}"."widget"`);
  return Number(r.rows[0].n);
}

beforeAll(async () => {
  admin = getPool();
  await admin.query(`DROP TABLE IF EXISTS public.widget CASCADE`);
  await admin.query(
    `CREATE TABLE public.widget (id serial PRIMARY KEY, name text NOT NULL, tenant_id uuid)`,
  );
  for (const slug of [slugA, slugB]) {
    const schema = tenantSchemaName(slug);
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.query(`CREATE TABLE ${schema}.widget (LIKE public.widget INCLUDING ALL)`);
  }
});

afterAll(async () => {
  for (const c of clients) await c.$disconnect().catch(() => {});
  for (const slug of [slugA, slugB]) {
    await admin.query(`DROP SCHEMA IF EXISTS ${tenantSchemaName(slug)} CASCADE`);
  }
  await admin.query(`DROP TABLE IF EXISTS public.widget CASCADE`);
  await closePool();
});

describe("schema-per-tenant Prisma routing against real Postgres", () => {
  it("withSchemaTenant never lets tenants share the default-schema tables", async () => {
    const prisma = new PrismaStandIn({ datasources: { db: { url: URL } } });
    clients.push(prisma);
    const as = (slug: string) => withSchemaTenant(prisma as never, () => slug) as unknown as PrismaStandIn;
    // Failing closed (throwing) is acceptable; sharing rows is not.
    const attempt = async <T>(fn: () => PromiseLike<T>): Promise<T | undefined> => {
      try {
        return await fn();
      } catch {
        return undefined;
      }
    };

    await attempt(() => as(slugA).widget.create({ data: { name: "a-only" } }));
    const seenByB = (await attempt(() => as(slugB).widget.findMany())) ?? [];

    expect(await count("public")).toBe(0);
    expect(seenByB).toEqual([]);
  });

  it("SchemaPrismaAdapter gives each tenant a client bound to its own schema", async () => {
    const adapter = new SchemaPrismaAdapter(
      PrismaStandIn as never,
      URL,
    );
    clients.push({ $disconnect: () => adapter.disconnectAll() });

    const a = adapter.getClient(slugA) as unknown as PrismaStandIn;
    const b = adapter.getClient(slugB) as unknown as PrismaStandIn;
    await a.widget.create({ data: { name: "a-row" } });
    await b.widget.create({ data: { name: "b-row" } });

    const aRows = (await a.widget.findMany()) as { name: string }[];
    const bRows = (await b.widget.findMany()) as { name: string }[];
    expect(aRows.map((r) => r.name)).toEqual(["a-row"]);
    expect(bRows.map((r) => r.name)).toEqual(["b-row"]);
    expect(await count(tenantSchemaName(slugA))).toBe(1);
    expect(await count("public")).toBe(0);
    expect(adapter.getClient(slugA)).toBe(a);
  });

  it("SchemaPrismaAdapter rejects an invalid slug", () => {
    const adapter = new SchemaPrismaAdapter(PrismaStandIn as never, URL);
    expect(() => adapter.getClient("x&schema=public")).toThrow();
  });
});
