import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import {
  getPool,
  closePool,
  runMigrations,
  cleanTestData,
} from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

// Drives the real control-plane app against a real Postgres to show that API
// key lifecycle rules hold at the HTTP boundary: a key stops working when its
// tenant is suspended, and a rotated key keeps the old key's restrictions.

process.env.JWT_SECRET = "integration-test-jwt-secret";
process.env.RATE_LIMIT_MAX = "1000";

type ControlPlaneApp = typeof import("../../control-plane/dist/app.js");
type ControlPlaneDb = typeof import("../../control-plane/dist/db/connection.js");

let app: Awaited<ReturnType<ControlPlaneApp["buildApp"]>>;
let cpDb: ControlPlaneDb;
let stratum: Stratum;

describe("control-plane API key lifecycle against real Postgres (integration)", () => {
  let tenantId: string;
  let operatorKey: string;

  beforeAll(async () => {
    await runMigrations();
    stratum = new Stratum({ pool: getPool() });
    const cpApp: ControlPlaneApp = await import("../../control-plane/dist/app.js");
    cpDb = await import("../../control-plane/dist/db/connection.js");
    app = await cpApp.buildApp();
    app.log.level = "silent";
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await cpDb.closePool();
    await cleanTestData();
    await closePool();
  });

  beforeEach(async () => {
    await cleanTestData();
    const tenant = await stratum.createTenant({ name: "Lifecycle", slug: uniqueSlug("lc") });
    tenantId = tenant.id;
    const op = await stratum.createApiKey(tenant.id, "operator");
    await getPool().query(
      "UPDATE api_keys SET tenant_id = NULL, scopes = $2 WHERE id = $1",
      [op.id, ["read", "write", "admin"]],
    );
    operatorKey = op.plaintext_key;
  });

  it("refuses a tenant's key while the tenant is suspended and accepts it once resumed", async () => {
    const key = await stratum.createApiKey(tenantId, "tenant-key");
    const get = () =>
      app.inject({
        method: "GET",
        url: `/api/v1/tenants/${tenantId}/config`,
        headers: { "x-api-key": key.plaintext_key },
      });

    expect((await get()).statusCode).toBe(200);
    await stratum.suspendTenant(tenantId);
    expect((await get()).statusCode).toBe(401);
    await stratum.resumeTenant(tenantId);
    expect((await get()).statusCode).toBe(200);
  });

  it("rotates a read-only key into a key that is still read-only", async () => {
    const key = await stratum.createApiKey(tenantId, "reader");
    const role = await stratum.createRole({ name: "lc-readers", scopes: ["read"], tenant_id: tenantId });
    await stratum.assignRoleToKey(key.id, role.id);

    const rotated = await app.inject({
      method: "POST",
      url: `/api/v1/api-keys/${key.id}/rotate`,
      headers: { "x-api-key": operatorKey },
      payload: {},
    });
    expect(rotated.statusCode).toBe(201);
    const newKey = rotated.json().plaintext_key as string;

    const write = await app.inject({
      method: "PUT",
      url: `/api/v1/tenants/${tenantId}/config/feature`,
      headers: { "x-api-key": newKey },
      payload: { value: true },
    });
    expect(write.statusCode).toBe(403);
  });
});
