import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import { getPool, closePool, runMigrations, cleanTestData } from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

// A caller must be able to tell a region conflict from a server fault, so the
// control plane answers 409 with a typed code, not 500 (#414).

process.env.JWT_SECRET = "integration-test-jwt-secret";
process.env.RATE_LIMIT_MAX = "1000";

type ControlPlaneApp = typeof import("../../control-plane/dist/app.js");
type ControlPlaneDb = typeof import("../../control-plane/dist/db/connection.js");

let app: Awaited<ReturnType<ControlPlaneApp["buildApp"]>>;
let cpDb: ControlPlaneDb;
let stratum: Stratum;
let operatorKey: string;

async function makeOperatorKey(): Promise<string> {
  const slug = uniqueSlug("r414op");
  const owner = await stratum.createTenant({ name: slug, slug });
  const key = await stratum.createApiKey(owner.id);
  await getPool().query(
    "UPDATE api_keys SET tenant_id = NULL, scopes = $2 WHERE id = $1",
    [key.id, ["read", "write", "admin"]],
  );
  return key.plaintext_key;
}

function send(method: "DELETE" | "POST", url: string, payload?: Record<string, unknown>) {
  return app.inject({ method, url, headers: { "x-api-key": operatorKey }, ...(payload ? { payload } : {}) });
}

describe("control-plane region conflict (integration)", () => {
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
    await closePool();
  });

  it("answers 409 REGION_IN_USE to DELETE of a region that has an active tenant", async () => {
    operatorKey = await makeOperatorKey();
    const region = await stratum.createRegion({ display_name: "InUse", slug: uniqueSlug("r414u") });
    const slug = uniqueSlug("r414t");
    const tenant = await stratum.createTenant({ name: slug, slug });
    await stratum.migrateRegion(tenant.id, region.id);

    const res = await send("DELETE", `/api/v1/regions/${region.id}`);

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("REGION_IN_USE");
    expect(res.json().error.message).toContain(region.id);
    // The region is still there.
    expect((await stratum.getRegion(region.id)).id).toBe(region.id);
  });

  it("answers 409 REGION_NOT_ACTIVE when a tenant migrates to a region that is not active", async () => {
    operatorKey = await makeOperatorKey();
    const region = await stratum.createRegion({
      display_name: "Draining",
      slug: uniqueSlug("r414d"),
      status: "draining",
    });
    const slug = uniqueSlug("r414t");
    const tenant = await stratum.createTenant({ name: slug, slug });

    const res = await send("POST", `/api/v1/tenants/${tenant.id}/migrate-region`, { region_id: region.id });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("REGION_NOT_ACTIVE");
    expect(res.json().error.message).toContain(region.id);
    // The tenant keeps its old region.
    const row = await getPool().query<{ region_id: string | null }>(
      "SELECT region_id FROM tenants WHERE id = $1",
      [tenant.id],
    );
    expect(row.rows[0].region_id).toBeNull();
  });
});
