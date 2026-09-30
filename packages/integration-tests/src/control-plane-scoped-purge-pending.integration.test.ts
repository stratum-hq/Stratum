import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import { getPool, closePool, runMigrations, cleanTestData } from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

// A tenant whose storage provisioning fails stays pending. The key that created
// it must be able to purge it, so the purge and delete scope checks resolve a
// pending target. This drives the real control-plane app against real Postgres.

process.env.JWT_SECRET = "integration-test-jwt-secret";
process.env.RATE_LIMIT_MAX = "1000";

type ControlPlaneApp = typeof import("../../control-plane/dist/app.js");
type ControlPlaneDb = typeof import("../../control-plane/dist/db/connection.js");

let app: Awaited<ReturnType<ControlPlaneApp["buildApp"]>>;
let cpDb: ControlPlaneDb;
let stratum: Stratum;

interface Fixture {
  parent: string;
  other: string;
  scopedKey: string;
}

let fx: Fixture;

async function makeAdminKey(tenantId: string): Promise<string> {
  const key = await stratum.createApiKey(tenantId);
  await getPool().query("UPDATE api_keys SET scopes = $2 WHERE id = $1", [
    key.id,
    ["read", "write", "admin"],
  ]);
  return key.plaintext_key;
}

/** Creates a tenant with its own schema, which the library inserts as pending. */
async function createPendingChild(parentId: string): Promise<string> {
  const slug = uniqueSlug("i349p");
  const tenant = await stratum.createTenant({
    name: slug,
    slug,
    parent_id: parentId,
    isolation_strategy: "SCHEMA_PER_TENANT",
  });
  expect(tenant.status).toBe("pending");
  return tenant.id;
}

async function statusOf(id: string): Promise<string | undefined> {
  const res = await getPool().query<{ status: string }>("SELECT status FROM tenants WHERE id = $1", [id]);
  return res.rows[0]?.status;
}

function request(method: "POST" | "DELETE", url: string) {
  return app.inject({ method, url, headers: { "x-api-key": fx.scopedKey } });
}

describe("scoped key cleanup of pending child tenants (integration)", () => {
  beforeAll(async () => {
    await runMigrations();
    stratum = new Stratum({ pool: getPool() });
    const cpApp: ControlPlaneApp = await import("../../control-plane/dist/app.js");
    cpDb = await import("../../control-plane/dist/db/connection.js");
    app = await cpApp.buildApp();
    app.log.level = "silent";
    await app.ready();
  });

  beforeEach(async () => {
    await cleanTestData();
    const parent = await stratum.createTenant({ name: "Parent", slug: uniqueSlug("i349a") });
    const other = await stratum.createTenant({ name: "Other", slug: uniqueSlug("i349b") });
    fx = { parent: parent.id, other: other.id, scopedKey: await makeAdminKey(parent.id) };
  });

  afterAll(async () => {
    await app.close();
    await cpDb.closePool();
    await cleanTestData();
    await closePool();
  });

  it("lets a scoped key purge its own pending child", async () => {
    const child = await createPendingChild(fx.parent);
    const res = await request("POST", `/api/v1/tenants/${child}/purge`);
    expect(res.statusCode).toBe(204);
    expect(await statusOf(child)).toBeUndefined();
  });

  it("refuses a scoped key that purges a pending tenant outside its subtree", async () => {
    const foreign = await createPendingChild(fx.other);
    const res = await request("POST", `/api/v1/tenants/${foreign}/purge`);
    expect(res.statusCode).toBe(403);
    expect(await statusOf(foreign)).toBe("pending");
  });

  it("still refuses a scoped key that purges its own archived child", async () => {
    const slug = uniqueSlug("i349c");
    const child = await stratum.createTenant({ name: slug, slug, parent_id: fx.parent });
    await stratum.archiveTenant(child.id);
    const res = await request("POST", `/api/v1/tenants/${child.id}/purge`);
    expect(res.statusCode).toBe(403);
    expect(await statusOf(child.id)).toBe("archived");
  });

  it("answers a scoped delete of its own pending child with the state error, not a scope error", async () => {
    const child = await createPendingChild(fx.parent);
    const res = await request("DELETE", `/api/v1/tenants/${child}`);
    expect(res.statusCode).toBe(409);
    expect(await statusOf(child)).toBe("pending");
  });

  it("refuses a scoped key that deletes a pending tenant outside its subtree", async () => {
    const foreign = await createPendingChild(fx.other);
    const res = await request("DELETE", `/api/v1/tenants/${foreign}`);
    expect(res.statusCode).toBe(403);
    expect(await statusOf(foreign)).toBe("pending");
  });
});
