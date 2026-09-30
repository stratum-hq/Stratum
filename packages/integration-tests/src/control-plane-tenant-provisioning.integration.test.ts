import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import pg from "pg";
import { Stratum } from "@stratum-hq/lib";
import {
  createSchema,
  dropSchema,
  schemaExists,
  tenantSchemaName,
  databaseExists,
  dropDatabase,
} from "@stratum-hq/db-adapters";
import { getPool, closePool, runMigrations, cleanTestData } from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

// POST /tenants for isolated strategies drives the real control-plane app
// against real Postgres: the tenant is inserted pending, its storage is
// provisioned, and only then is it activated. A provisioning failure leaves it
// pending (never purged by the route), and purging it later never drops
// storage it did not provision.

process.env.JWT_SECRET = "integration-test-jwt-secret";
process.env.RATE_LIMIT_MAX = "1000";

type ControlPlaneApp = typeof import("../../control-plane/dist/app.js");
type ControlPlaneDb = typeof import("../../control-plane/dist/db/connection.js");

let app: Awaited<ReturnType<ControlPlaneApp["buildApp"]>>;
let cpDb: ControlPlaneDb;
let stratum: Stratum;
let operatorKey: string;
const schemaSlugs: string[] = [];
const databaseSlugs: string[] = [];

async function withConn<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await getPool().connect();
  try {
    return await fn(c);
  } finally {
    c.release();
  }
}

async function makeOperatorKey(): Promise<string> {
  const slug = uniqueSlug("a9op");
  const owner = await stratum.createTenant({ name: slug, slug });
  const key = await stratum.createApiKey(owner.id);
  await getPool().query(
    "UPDATE api_keys SET tenant_id = NULL, scopes = $2 WHERE id = $1",
    [key.id, ["read", "write", "admin"]],
  );
  return key.plaintext_key;
}

function post(url: string, payload?: Record<string, unknown>) {
  return app.inject({ method: "POST", url, headers: { "x-api-key": operatorKey }, ...(payload ? { payload } : {}) });
}

async function statusOf(id: string): Promise<string | undefined> {
  const res = await getPool().query<{ status: string }>("SELECT status FROM tenants WHERE id = $1", [id]);
  return res.rows[0]?.status;
}

describe("control-plane tenant provisioning (integration)", () => {
  beforeAll(async () => {
    await runMigrations();
    stratum = new Stratum({ pool: getPool() });
    const cpApp: ControlPlaneApp = await import("../../control-plane/dist/app.js");
    cpDb = await import("../../control-plane/dist/db/connection.js");
    app = await cpApp.buildApp();
    app.log.level = "silent";
    await app.ready();
  });

  afterEach(async () => {
    await cleanTestData();
  });

  afterAll(async () => {
    await app.close();
    await cpDb.closePool();
    await withConn(async (c) => {
      for (const slug of schemaSlugs) await dropSchema(c, slug).catch(() => {});
      for (const slug of databaseSlugs) await dropDatabase(c, slug).catch(() => {});
    });
    await closePool();
  });

  it("creates a SCHEMA_PER_TENANT tenant active with its schema, and purge drops the schema", async () => {
    operatorKey = await makeOperatorKey();
    const slug = uniqueSlug("a9cs");
    schemaSlugs.push(slug);

    const res = await post("/api/v1/tenants", { name: slug, slug, isolation_strategy: "SCHEMA_PER_TENANT" });
    expect(res.statusCode).toBe(201);
    const tenant = res.json();
    expect(tenant.status).toBe("active");
    expect(await statusOf(tenant.id)).toBe("active");
    await withConn(async (c) => expect(await schemaExists(c, slug)).toBe(true));

    expect((await post(`/api/v1/tenants/${tenant.id}/purge`)).statusCode).toBe(204);
    await withConn(async (c) => expect(await schemaExists(c, slug)).toBe(false));
  });

  it("creates a DB_PER_TENANT tenant active with its database, and purge drops the database", async () => {
    operatorKey = await makeOperatorKey();
    const slug = uniqueSlug("a9cd");
    databaseSlugs.push(slug);

    const res = await post("/api/v1/tenants", { name: slug, slug, isolation_strategy: "DB_PER_TENANT" });
    expect(res.statusCode).toBe(201);
    const tenant = res.json();
    expect(tenant.status).toBe("active");
    await withConn(async (c) => expect(await databaseExists(c, slug)).toBe(true));

    expect((await post(`/api/v1/tenants/${tenant.id}/purge`)).statusCode).toBe(204);
    await withConn(async (c) => expect(await databaseExists(c, slug)).toBe(false));
  });

  it("leaves the tenant pending when provisioning fails, and purging it keeps storage it did not create", async () => {
    operatorKey = await makeOperatorKey();
    const slug = uniqueSlug("a9cs");
    schemaSlugs.push(slug);
    // Pre-existing storage under the new tenant's name makes provisioning fail.
    await withConn(async (c) => {
      await createSchema(c, slug);
      await c.query(`CREATE TABLE ${tenantSchemaName(slug)}.note (body text)`);
      await c.query(`INSERT INTO ${tenantSchemaName(slug)}.note VALUES ('not yours')`);
    });

    const res = await post("/api/v1/tenants", { name: slug, slug, isolation_strategy: "SCHEMA_PER_TENANT" });
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    const body = res.json();
    expect(body.error.code).toBe("TENANT_PROVISIONING_FAILED");
    const tenantId = body.error.details.tenant_id as string;
    expect(await statusOf(tenantId)).toBe("pending");

    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/tenants?status=pending",
      headers: { "x-api-key": operatorKey },
    });
    expect(listed.json().data.map((t: { id: string }) => t.id)).toEqual([tenantId]);

    expect((await post(`/api/v1/tenants/${tenantId}/purge`)).statusCode).toBe(204);
    expect(await statusOf(tenantId)).toBeUndefined();
    await withConn(async (c) => {
      const rows = await c.query(`SELECT body FROM ${tenantSchemaName(slug)}.note`);
      expect(rows.rows).toEqual([{ body: "not yours" }]);
    });
  });
});
