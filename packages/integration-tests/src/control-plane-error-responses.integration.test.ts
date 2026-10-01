import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import { getPool, closePool, runMigrations, cleanTestData, getAdminPool } from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

// Drives the real control-plane app against a real Postgres: a path id that is
// not a UUID gets 400 instead of the database's refusal as a 500, an unknown
// route gets the error envelope, and a refused config batch gets a 4xx with
// the per-key result.

process.env.JWT_SECRET = "integration-test-jwt-secret";
process.env.RATE_LIMIT_MAX = "10000";

type ControlPlaneApp = typeof import("../../control-plane/dist/app.js");
type ControlPlaneDb = typeof import("../../control-plane/dist/db/connection.js");

let app: Awaited<ReturnType<ControlPlaneApp["buildApp"]>>;
let cpDb: ControlPlaneDb;
let stratum: Stratum;
let operatorKey: string;

const UUID_PARAMS = new Set(["id", "tenantId", "policyId", "keyId", "deliveryId"]);
const GOOD_ID = "00000000-0000-0000-0000-000000000000";

function send(method: string, url: string, payload?: unknown) {
  return app.inject({
    method: method as "GET",
    url,
    headers: { "x-api-key": operatorKey },
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  });
}

describe("control-plane error responses against real Postgres (integration)", () => {
  beforeAll(async () => {
    await runMigrations();
    stratum = new Stratum({ pool: getPool(), adminPool: getAdminPool() });
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
    const owner = await stratum.createTenant({ name: "Errors", slug: uniqueSlug("err") });
    const op = await stratum.createApiKey(owner.id, "operator");
    await getPool().query("UPDATE api_keys SET tenant_id = NULL, scopes = $2 WHERE id = $1", [
      op.id,
      ["read", "write", "admin"],
    ]);
    operatorKey = op.plaintext_key;
  });

  it("answers 400 VALIDATION_ERROR for a non-UUID path id on every documented route", async () => {
    // @fastify/swagger decorates the app with swagger(); its types are not a dependency here.
    const spec = (app as unknown as { swagger(): { paths: Record<string, Record<string, unknown>> } }).swagger();
    const failures: string[] = [];
    let checked = 0;
    for (const [template, operations] of Object.entries(spec.paths)) {
      const params = [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((p) => UUID_PARAMS.has(p));
      for (const bad of params) {
        const url = template.replace(/\{(\w+)\}/g, (_m, name: string) =>
          name === bad ? "not-a-uuid" : UUID_PARAMS.has(name) ? GOOD_ID : "some.key",
        );
        for (const method of Object.keys(operations)) {
          const upper = method.toUpperCase();
          const res = await send(upper, url, ["POST", "PUT", "PATCH"].includes(upper) ? {} : undefined);
          checked++;
          if (res.statusCode !== 400 || res.json().error?.code !== "VALIDATION_ERROR") {
            failures.push(`${upper} ${template} (${bad}): ${res.statusCode} ${res.body}`);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(40);
    expect(failures).toEqual([]);
  });

  it("answers 400 VALIDATION_ERROR for a non-UUID query-string tenant id", async () => {
    const failures: string[] = [];
    for (const url of [
      "/api/v1/webhooks?tenant_id=not-a-uuid",
      "/api/v1/api-keys?tenant_id=not-a-uuid",
      "/api/v1/roles?tenant_id=not-a-uuid",
      `/api/v1/config/diff?tenant_a=not-a-uuid&tenant_b=${GOOD_ID}`,
      `/api/v1/config/diff?tenant_a=${GOOD_ID}&tenant_b=not-a-uuid`,
    ]) {
      const res = await send("GET", url);
      if (res.statusCode !== 400 || res.json().error?.code !== "VALIDATION_ERROR") {
        failures.push(`${url}: ${res.statusCode} ${res.body}`);
      }
    }
    expect(failures).toEqual([]);
    const ok = await send("GET", `/api/v1/roles?tenant_id=${GOOD_ID}`);
    expect(ok.statusCode).toBe(200);
  });

  it("answers an unknown route with the NOT_FOUND envelope", async () => {
    const res = await send("GET", "/api/v1/no-such-route");
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: "NOT_FOUND", message: "Route GET /api/v1/no-such-route not found" } });
  });

  describe("PUT /api/v1/tenants/:id/config/batch", () => {
    let parentId: string;
    let childId: string;

    beforeEach(async () => {
      const parent = await stratum.createTenant({ name: "Parent", slug: uniqueSlug("bp") });
      const child = await stratum.createTenant({ name: "Child", slug: uniqueSlug("bc"), parent_id: parent.id });
      parentId = parent.id;
      childId = child.id;
      await stratum.setConfig(parentId, "limits.max_users", { value: 100, locked: true });
    });

    async function childKeys(): Promise<string[]> {
      const res = await getPool().query("SELECT key FROM config_entries WHERE tenant_id = $1 AND inherited = false", [childId]);
      return res.rows.map((r: { key: string }) => r.key);
    }

    it("answers 403 CONFIG_LOCKED with the per-key result and writes nothing when a key is locked", async () => {
      const res = await send("PUT", `/api/v1/tenants/${childId}/config/batch`, {
        entries: [
          { key: "feature.theme", value: "dark" },
          { key: "limits.max_users", value: 500 },
        ],
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.error.code).toBe("CONFIG_LOCKED");
      expect(body.error.details.rolled_back).toBe(true);
      expect(body.error.details.succeeded).toBe(0);
      expect(body.error.details.failed).toBe(2);
      expect(body.error.details.results.map((r: { key: string; status: string }) => [r.key, r.status])).toEqual([
        ["feature.theme", "error"],
        ["limits.max_users", "error"],
      ]);
      expect(body.error.details.results[1].error).toContain("locked");
      expect(await childKeys()).toEqual([]);
    });

    it("answers 400 VALIDATION_ERROR and writes nothing when an entry is invalid", async () => {
      const res = await send("PUT", `/api/v1/tenants/${childId}/config/batch`, {
        entries: [{ key: "feature.theme", value: "dark" }, { key: "" , value: 1 }],
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.details.issues[0].path).toEqual(["entries", 1, "key"]);
      expect(body.error.details.rolled_back).toBe(true);
      expect(await childKeys()).toEqual([]);
    });

    it("answers 200 with the per-key result when every entry is written", async () => {
      const res = await send("PUT", `/api/v1/tenants/${childId}/config/batch`, {
        entries: [
          { key: "feature.theme", value: "dark" },
          { key: "feature.beta", value: true },
        ],
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.succeeded).toBe(2);
      expect(body.rolled_back).toBe(false);
      expect((await childKeys()).sort()).toEqual(["feature.beta", "feature.theme"]);
    });

    it("answers a single write of a locked key with 403 CONFIG_LOCKED, as the docs say", async () => {
      const res = await send("PUT", `/api/v1/tenants/${childId}/config/limits.max_users`, { value: 500 });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("CONFIG_LOCKED");
    });
  });
});
