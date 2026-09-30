import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import { getPool, closePool, runMigrations, cleanTestData } from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

// A caller must be able to tell a missing region from a server fault, so the
// control plane answers 404 with a typed code, not 500.

process.env.JWT_SECRET = "integration-test-jwt-secret";
process.env.RATE_LIMIT_MAX = "1000";

type ControlPlaneApp = typeof import("../../control-plane/dist/app.js");
type ControlPlaneDb = typeof import("../../control-plane/dist/db/connection.js");

const MISSING_ID = "00000000-0000-0000-0000-000000000000";

let app: Awaited<ReturnType<ControlPlaneApp["buildApp"]>>;
let cpDb: ControlPlaneDb;
let stratum: Stratum;
let operatorKey: string;

async function makeOperatorKey(): Promise<string> {
  const slug = uniqueSlug("r408op");
  const owner = await stratum.createTenant({ name: slug, slug });
  const key = await stratum.createApiKey(owner.id);
  await getPool().query(
    "UPDATE api_keys SET tenant_id = NULL, scopes = $2 WHERE id = $1",
    [key.id, ["read", "write", "admin"]],
  );
  return key.plaintext_key;
}

function send(method: "GET" | "PATCH" | "DELETE" | "POST", url: string, payload?: Record<string, unknown>) {
  return app.inject({ method, url, headers: { "x-api-key": operatorKey }, ...(payload ? { payload } : {}) });
}

describe("control-plane region not found (integration)", () => {
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

  it.each([
    ["GET", undefined],
    ["PATCH", { display_name: "Renamed" }],
    ["DELETE", undefined],
  ] as const)("answers 404 REGION_NOT_FOUND to %s of a missing region", async (method, payload) => {
    operatorKey = await makeOperatorKey();

    const res = await send(method, `/api/v1/regions/${MISSING_ID}`, payload);

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("REGION_NOT_FOUND");
    expect(res.json().error.message).toContain(MISSING_ID);
  });

  it("answers 404 REGION_NOT_FOUND when a tenant migrates to a missing region", async () => {
    operatorKey = await makeOperatorKey();
    const slug = uniqueSlug("r408t");
    const tenant = await stratum.createTenant({ name: slug, slug });

    const res = await send("POST", `/api/v1/tenants/${tenant.id}/migrate-region`, { region_id: MISSING_ID });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("REGION_NOT_FOUND");
  });

  it("answers 404 TENANT_NOT_FOUND when a missing tenant migrates to a region", async () => {
    operatorKey = await makeOperatorKey();
    const region = await stratum.createRegion({ display_name: "R", slug: uniqueSlug("r408r") });

    const res = await send("POST", `/api/v1/tenants/${MISSING_ID}/migrate-region`, { region_id: region.id });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("TENANT_NOT_FOUND");
  });
});
