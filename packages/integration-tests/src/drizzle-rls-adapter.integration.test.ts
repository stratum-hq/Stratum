import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { pgTable, serial, text, uuid } from "drizzle-orm/pg-core";
import { drizzleWithTenant } from "@stratum-hq/db-adapters";
import { getPool, closePool } from "./helpers/db.js";

/**
 * drizzleWithTenant (SHARED_RLS) with a real drizzle-orm client against real
 * Postgres. The app pool runs as a non-superuser, NOBYPASSRLS role on a FORCE
 * RLS table, so rows are visible only if the tenant context is set on the
 * query's own transaction.
 */

const APP_ROLE = "stratum_drizzle_rls_test";
const TENANT_A = "0a0a0a0a-0000-4000-8000-0000000000da";
const TENANT_B = "0b0b0b0b-0000-4000-8000-0000000000db";
const URL = process.env.DATABASE_URL ||
  "postgresql://stratum_test:stratum_test@localhost:5433/stratum_test";

const items = pgTable("dz_item", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  tenantId: uuid("tenant_id"),
});

let admin: pg.Pool;
let appPool: pg.Pool;

beforeAll(async () => {
  admin = getPool();
  await admin.query(`DO $$ BEGIN
    CREATE ROLE ${APP_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
  await admin.query(`DROP TABLE IF EXISTS public.dz_item`);
  await admin.query(`CREATE TABLE public.dz_item (id serial PRIMARY KEY, name text NOT NULL, tenant_id uuid)`);
  await admin.query(`ALTER TABLE public.dz_item ENABLE ROW LEVEL SECURITY`);
  await admin.query(`ALTER TABLE public.dz_item FORCE ROW LEVEL SECURITY`);
  await admin.query(
    `CREATE POLICY tenant_isolation ON public.dz_item
     USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)`,
  );
  await admin.query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
  await admin.query(`GRANT SELECT, INSERT ON public.dz_item TO ${APP_ROLE}`);
  await admin.query(`GRANT USAGE ON SEQUENCE public.dz_item_id_seq TO ${APP_ROLE}`);
  await admin.query(
    `INSERT INTO public.dz_item (name, tenant_id) VALUES ('a-seed', $1), ('b-seed', $2)`,
    [TENANT_A, TENANT_B],
  );

  appPool = new pg.Pool({ connectionString: URL, max: 2 });
  appPool.on("connect", (c) => {
    c.query(`SET ROLE ${APP_ROLE}`).catch(() => {});
  });
});

afterAll(async () => {
  await appPool.end();
  await admin.query(`DROP TABLE IF EXISTS public.dz_item`);
  await closePool();
});

describe("drizzleWithTenant against real Postgres RLS", () => {
  it("execute runs the statement with the tenant context set", async () => {
    const tenantDb = drizzleWithTenant(drizzle(appPool), () => TENANT_A, appPool);
    const res = (await tenantDb.execute(
      sql`SELECT current_setting('app.current_tenant_id', true) AS t`,
    )) as { rows: { t: string }[] };
    expect(res.rows[0].t).toBe(TENANT_A);
  });

  it("transaction scopes query-builder reads and writes to the current tenant", async () => {
    const tenantDb = drizzleWithTenant(drizzle(appPool), () => TENANT_B, appPool);
    const rows = await tenantDb.transaction(async (tx) => {
      await tx.insert(items).values({ name: "b-new", tenantId: TENANT_B });
      return tx.select({ name: items.name }).from(items).orderBy(items.id);
    });
    expect(rows.map((r) => r.name)).toEqual(["b-seed", "b-new"]);
  });
});
