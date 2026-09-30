import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import { StratumClient, expressMiddleware, getTenantContext } from "@stratum-hq/sdk";
import type { ResolvedTenantContext } from "@stratum-hq/core";
import {
  getPool,
  closePool,
  runMigrations,
  cleanTestData,
} from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

// Runs the SDK against the real control-plane app over HTTP, backed by a real
// Postgres, so the /tenants/:id/context response contract is checked from both
// ends rather than against a hand-written mock.

process.env.JWT_SECRET ??= "integration-test-jwt-secret";
process.env.RATE_LIMIT_MAX = "1000";

type ControlPlaneApp = typeof import("../../control-plane/dist/app.js");
type ControlPlaneDb = typeof import("../../control-plane/dist/db/connection.js");

let app: Awaited<ReturnType<ControlPlaneApp["buildApp"]>>;
let cpDb: ControlPlaneDb;
let stratum: Stratum;
let baseUrl: string;
let parentId: string;
let childId: string;
let adminKey: string;

describe("SDK against the real control plane (integration)", () => {
  beforeAll(async () => {
    await runMigrations();
    stratum = new Stratum({ pool: getPool() });
    const cpApp: ControlPlaneApp = await import("../../control-plane/dist/app.js");
    cpDb = await import("../../control-plane/dist/db/connection.js");
    app = await cpApp.buildApp();
    app.log.level = "silent";
    baseUrl = await app.listen({ port: 0, host: "127.0.0.1" });
  });

  afterAll(async () => {
    await app.close();
    await cpDb.closePool();
    await cleanTestData();
    await closePool();
  });

  beforeEach(async () => {
    await cleanTestData();
    const parent = await stratum.createTenant({ name: "Parent", slug: uniqueSlug("p") });
    const child = await stratum.createTenant({ name: "Child", slug: uniqueSlug("c"), parent_id: parent.id });
    parentId = parent.id;
    childId = child.id;
    await stratum.setConfig(parent.id, "max_users", { value: 500 });
    await stratum.createPermission(parent.id, { key: "manage_users", value: true });
    const key = await stratum.createApiKey(parent.id);
    await getPool().query("UPDATE api_keys SET scopes = $2 WHERE id = $1", [
      key.id,
      ["read", "write", "admin"],
    ]);
    adminKey = key.plaintext_key;
  });

  it("serves the flat ResolvedTenantContext from GET /tenants/:id/context", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/tenants/${childId}/context`,
      headers: { "x-api-key": adminKey },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ResolvedTenantContext;
    expect(Object.keys(body).sort()).toEqual([
      "ancestry_path",
      "depth",
      "isolation_strategy",
      "resolved_config",
      "resolved_permissions",
      "tenant_id",
    ]);
    expect(body.tenant_id).toBe(childId);
    expect(body.depth).toBe(1);
    expect(body.isolation_strategy).toBe("SHARED_RLS");
    expect(typeof body.ancestry_path).toBe("string");
    expect(body.ancestry_path).toContain(parentId);
    expect((body.resolved_config["max_users"] as { value: unknown }).value).toBe(500);
    expect(body.resolved_permissions["manage_users"]?.value).toBe(true);
  });

  it("resolves the requested tenant through StratumClient.resolveTenant", async () => {
    const client = new StratumClient({ controlPlaneUrl: baseUrl, apiKey: adminKey, cache: { enabled: false } });
    const ctx = await client.resolveTenant(childId);
    expect(ctx.tenant_id).toBe(childId);
    expect(ctx.depth).toBe(1);
    expect(ctx.isolation_strategy).toBe("SHARED_RLS");
    expect((ctx.resolved_config["max_users"] as { value: unknown }).value).toBe(500);
  });

  it("binds req.tenant.tenant_id and the ALS context through the Express middleware", async () => {
    const client = new StratumClient({ controlPlaneUrl: baseUrl, apiKey: adminKey, cache: { enabled: false } });
    const mw = expressMiddleware(client);
    const req: { headers: Record<string, string>; tenant?: unknown } = {
      headers: { "x-tenant-id": childId },
    };
    let alsTenantId: string | undefined;
    let nextErr: unknown;
    await mw(req, { status: () => ({ json: () => undefined }) }, (err?: unknown) => {
      nextErr = err;
      alsTenantId = getTenantContext().tenant_id;
    });
    expect(nextErr).toBeUndefined();
    expect((req.tenant as ResolvedTenantContext).tenant_id).toBe(childId);
    expect(alsTenantId).toBe(childId);
  });
});
