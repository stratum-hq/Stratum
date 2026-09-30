import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type pg from "pg";
import { prismaWithTenant } from "@stratum-hq/db-adapters";
import { getPool, closePool } from "./helpers/db.js";
import { PrismaStandIn } from "./helpers/prisma-standin.js";

/**
 * prismaWithTenant (SHARED_RLS) against real Postgres, through a Prisma
 * stand-in that reproduces Prisma 5's connection behavior (see
 * helpers/prisma-standin.ts). The client connects as a non-superuser,
 * NOBYPASSRLS role on a FORCE RLS table, so the tenant GUC must be set on the
 * same connection and transaction as the model query for anything to work.
 */

const APP_ROLE = "stratum_prisma_rls_test";
const TENANT_A = "0a0a0a0a-0000-4000-8000-00000000000a";
const TENANT_B = "0b0b0b0b-0000-4000-8000-00000000000b";
const URL = process.env.DATABASE_URL ||
  "postgresql://stratum_test:stratum_test@localhost:5433/stratum_test";

let admin: pg.Pool;
const clients: PrismaStandIn[] = [];

function makeClient(opts: { connectionLimit?: number; poolTimeoutMs?: number } = {}) {
  const c = new PrismaStandIn({ datasources: { db: { url: URL } }, role: APP_ROLE, ...opts });
  clients.push(c);
  return c;
}

beforeAll(async () => {
  admin = getPool();
  await admin.query(`DO $$ BEGIN
    CREATE ROLE ${APP_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
  await admin.query(`DROP TABLE IF EXISTS public.widget CASCADE`);
  await admin.query(
    `CREATE TABLE public.widget (id serial PRIMARY KEY, name text NOT NULL, tenant_id uuid)`,
  );
  await admin.query(`ALTER TABLE public.widget ENABLE ROW LEVEL SECURITY`);
  await admin.query(`ALTER TABLE public.widget FORCE ROW LEVEL SECURITY`);
  await admin.query(
    `CREATE POLICY tenant_isolation ON public.widget
     USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)`,
  );
  await admin.query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
  await admin.query(`GRANT SELECT, INSERT ON public.widget TO ${APP_ROLE}`);
  await admin.query(`GRANT USAGE ON SEQUENCE public.widget_id_seq TO ${APP_ROLE}`);
  await admin.query(
    `INSERT INTO public.widget (name, tenant_id) VALUES ('a-seed', $1), ('b-seed', $2)`,
    [TENANT_A, TENANT_B],
  );
});

afterAll(async () => {
  for (const c of clients) await c.$disconnect().catch(() => {});
  await admin.query(`DROP TABLE IF EXISTS public.widget CASCADE`);
  await closePool();
});

describe("prismaWithTenant against real Postgres RLS", () => {
  it("reads only the current tenant's rows", async () => {
    const prisma = makeClient();
    const a = prismaWithTenant(prisma as never, () => TENANT_A, admin) as unknown as PrismaStandIn;
    const rows = (await a.widget.findMany()) as { name: string }[];
    expect(rows.map((r) => r.name)).toEqual(["a-seed"]);
  });

  it("writes rows for the current tenant", async () => {
    const prisma = makeClient();
    const b = prismaWithTenant(prisma as never, () => TENANT_B, admin) as unknown as PrismaStandIn;
    await b.widget.create({ data: { name: "b-new", tenant_id: TENANT_B } });
    const rows = (await b.widget.findMany()) as { name: string }[];
    expect(rows.map((r) => r.name).sort()).toEqual(["b-new", "b-seed"]);
  });

  it("completes when the client has a single pooled connection", async () => {
    const prisma = makeClient({ connectionLimit: 1, poolTimeoutMs: 2000 });
    const a = prismaWithTenant(prisma as never, () => TENANT_A, admin) as unknown as PrismaStandIn;
    await expect(a.widget.findMany()).resolves.toHaveLength(1);
  });

  it("rejects an empty tenant id", async () => {
    const prisma = makeClient();
    const none = prismaWithTenant(prisma as never, () => "", admin) as unknown as PrismaStandIn;
    await expect(none.widget.findMany()).rejects.toThrow(/tenant/i);
  });
});
