import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import { getPool, closePool, runMigrations, cleanTestData } from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

// A config write over the control-plane API that leaves out `sensitive` keeps
// the key's current flag; an explicit `sensitive: false` clears a flag the
// tenant set itself. Driven against real Postgres and the real control-plane app.

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "integration-test-jwt-secret";
process.env.RATE_LIMIT_MAX = "1000";

type ControlPlaneApp = typeof import("../../control-plane/dist/app.js");
type ControlPlaneDb = typeof import("../../control-plane/dist/db/connection.js");

let app: Awaited<ReturnType<ControlPlaneApp["buildApp"]>>;
let cpDb: ControlPlaneDb;
let stratum: Stratum;
let tenantId: string;
let apiKey: string;

async function storedRow(key: string) {
  const res = await getPool().query<{ value: unknown; sensitive: boolean }>(
    "SELECT value, sensitive FROM config_entries WHERE tenant_id = $1 AND key = $2",
    [tenantId, key],
  );
  return res.rows[0];
}

function put(url: string, payload: Record<string, unknown>) {
  return app.inject({ method: "PUT", url, headers: { "x-api-key": apiKey }, payload });
}

describe("config writes over the API keep the sensitive flag (integration)", () => {
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
    const tenant = await stratum.createTenant({ name: "Own", slug: uniqueSlug("sfa") });
    tenantId = tenant.id;
    const created = await stratum.createApiKey(tenantId);
    await getPool().query("UPDATE api_keys SET scopes = $2 WHERE id = $1", [created.id, ["read", "write"]]);
    apiKey = created.plaintext_key;
    await stratum.setConfig(tenantId, "own_secret", { value: "first", sensitive: true });
  });

  it("PUT without sensitive keeps the tenant's own sensitive key sensitive", async () => {
    const res = await put(`/api/v1/tenants/${tenantId}/config/own_secret`, { value: "second" });
    expect(res.statusCode).toBe(200);
    expect(res.json().sensitive).toBe(true);

    const row = await storedRow("own_secret");
    expect(row.sensitive).toBe(true);
    expect(JSON.stringify(row.value)).not.toContain("second");
    expect((await stratum.resolveConfig(tenantId)).own_secret).toMatchObject({ value: "second", sensitive: true });
  });

  it("PUT with sensitive: false clears the tenant's own flag", async () => {
    const res = await put(`/api/v1/tenants/${tenantId}/config/own_secret`, { value: "third", sensitive: false });
    expect(res.statusCode).toBe(200);
    expect(res.json().sensitive).toBe(false);
    expect(await storedRow("own_secret")).toEqual({ value: "third", sensitive: false });
  });

  it("a batch entry without sensitive keeps the tenant's own sensitive key sensitive", async () => {
    const res = await put(`/api/v1/tenants/${tenantId}/config/batch`, {
      entries: [{ key: "own_secret", value: "batch-value" }],
    });
    expect(res.statusCode).toBe(200);

    const row = await storedRow("own_secret");
    expect(row.sensitive).toBe(true);
    expect(JSON.stringify(row.value)).not.toContain("batch-value");
  });

  it("a batch that names the same key twice returns 400 and writes nothing", async () => {
    const res = await put(`/api/v1/tenants/${tenantId}/config/batch`, {
      entries: [
        { key: "dup_key", value: "a", sensitive: true },
        { key: "dup_key", value: "b" },
      ],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect(await storedRow("dup_key")).toBeUndefined();
  });
});
