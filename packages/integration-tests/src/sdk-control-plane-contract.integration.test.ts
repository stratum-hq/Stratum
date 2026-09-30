import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import { StratumClient, expressMiddleware, getTenantContext } from "@stratum-hq/sdk";
import type { ResolvedTenantContext } from "@stratum-hq/core";
import {
  ForbiddenError,
  RegionInUseError,
  RegionNotFoundError,
  TenantArchivedError,
  TenantNotFoundError,
  TenantSuspendedError,
  ValidationError,
  WebhookNotFoundError,
} from "@stratum-hq/core";
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

  // A scoped key cannot see past a descendant that is not active: the scope
  // check fails closed with 403 FORBIDDEN first. An operator key reaches the
  // tenant lookup, so it receives the tenant state errors.
  async function operatorClient(): Promise<StratumClient> {
    const key = await stratum.createApiKey(parentId);
    await getPool().query("UPDATE api_keys SET tenant_id = NULL, scopes = $2 WHERE id = $1", [
      key.id,
      ["read", "write", "admin"],
    ]);
    return new StratumClient({ controlPlaneUrl: baseUrl, apiKey: key.plaintext_key, cache: { enabled: false } });
  }

  it("maps a suspended tenant to TenantSuspendedError, and the middleware answers 403", async () => {
    await stratum.suspendTenant(childId);
    const client = await operatorClient();

    await expect(client.resolveTenant(childId)).rejects.toBeInstanceOf(TenantSuspendedError);

    const status = await middlewareStatus(client, childId);
    expect(status).toBe(403);
  });

  it("maps an archived tenant to TenantArchivedError, and the middleware answers 410", async () => {
    await stratum.archiveTenant(childId);
    const client = await operatorClient();

    await expect(client.resolveTenant(childId)).rejects.toBeInstanceOf(TenantArchivedError);

    const status = await middlewareStatus(client, childId);
    expect(status).toBe(410);
  });

  it("maps a scoped key's denied descendant to ForbiddenError, and the middleware answers 403", async () => {
    await stratum.suspendTenant(childId);
    const client = new StratumClient({ controlPlaneUrl: baseUrl, apiKey: adminKey, cache: { enabled: false } });

    await expect(client.resolveTenant(childId)).rejects.toBeInstanceOf(ForbiddenError);

    const status = await middlewareStatus(client, childId);
    expect(status).toBe(403);
  });

  // The control plane rejects a JSON content type with an empty body, so these
  // body-less requests only succeed when the client omits that header (#385).
  describe("body-less requests", () => {
    it("archives a tenant through archiveTenant", async () => {
      const client = await operatorClient();
      await client.archiveTenant(childId);
      expect((await stratum.getTenant(childId, true)).status).toBe("archived");
    });

    it("archives a tenant through deleteTenant", async () => {
      const client = await operatorClient();
      await client.deleteTenant(childId);
      expect((await stratum.getTenant(childId, true)).status).toBe("archived");
    });

    it("purges a tenant through purgeTenant", async () => {
      const client = await operatorClient();
      await client.purgeTenant(childId);
      await expect(stratum.getTenant(childId, true)).rejects.toBeInstanceOf(TenantNotFoundError);
    });

    it("deletes a webhook through deleteWebhook", async () => {
      const hook = await stratum.createWebhook({
        tenant_id: parentId,
        url: "https://example.com/hook",
        secret: "integration-test-webhook-secret",
        events: ["tenant.created"],
      });
      const client = await operatorClient();
      await client.deleteWebhook(hook.id);
      const res = await getPool().query("SELECT 1 FROM webhooks WHERE id = $1", [hook.id]);
      expect(res.rowCount).toBe(0);
    });

    it("deletes a region through deleteRegion", async () => {
      const region = await stratum.createRegion({ display_name: "EU", slug: uniqueSlug("eu") });
      const client = await operatorClient();
      await client.deleteRegion(region.id);
      const res = await getPool().query("SELECT 1 FROM regions WHERE id = $1", [region.id]);
      expect(res.rowCount).toBe(0);
    });
  });

  it("keeps a single 'Tenant not found' prefix on a missing tenant", async () => {
    const missingId = "00000000-0000-4000-8000-000000000000";
    const client = await operatorClient();

    const err = await client.resolveTenant(missingId).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TenantNotFoundError);
    expect((err as Error).message).toBe(`Tenant not found: ${missingId}`);
  });

  // Every route can answer 404, so the client maps a 404 by its error code.
  describe("404 mapping by error code", () => {
    const missingId = "00000000-0000-4000-8000-000000000000";

    it("maps a missing webhook to WebhookNotFoundError", async () => {
      const client = await operatorClient();

      const err = await client.getWebhook(missingId).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(WebhookNotFoundError);
      expect((err as Error).message).toBe(`Webhook not found: ${missingId}`);
    });

    it("maps a missing API key to a plain Error, not TenantNotFoundError", async () => {
      const client = new StratumClient({ controlPlaneUrl: baseUrl, apiKey: adminKey, cache: { enabled: false } });

      const err = await client.rotateApiKey(missingId).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(TenantNotFoundError);
      expect((err as Error).message).toBe("API key not found or already revoked");
    });
  });

  // A route can reject a body itself or leave it to the error handler. The SDK
  // must get the issues in error.details.issues from both paths.
  describe("validation error mapping", () => {
    it("maps an invalid createTenant body to ValidationError with the issues", async () => {
      const client = await operatorClient();

      const err = await client.createTenant({ name: "No Slug" } as never).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).details?.issues).toEqual([
        { path: ["slug"], message: expect.any(String), code: "invalid_type" },
      ]);
    });

    it("maps an invalid createRegion body to ValidationError with the issues", async () => {
      const client = await operatorClient();

      const err = await client.createRegion({ display_name: "EU", slug: "Not A Slug" }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).details?.issues).toEqual([
        { path: ["slug"], message: expect.any(String), code: "invalid_string" },
      ]);
    });
  });

  describe("region error mapping", () => {
    it("maps a missing region to RegionNotFoundError", async () => {
      const missingId = "00000000-0000-4000-8000-000000000000";
      const client = await operatorClient();

      const err = await client.deleteRegion(missingId).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RegionNotFoundError);
      expect((err as Error).message).toBe(`Region not found: ${missingId}`);
    });

    it("maps the deletion of a region in use to RegionInUseError", async () => {
      const region = await stratum.createRegion({ display_name: "InUse", slug: uniqueSlug("inuse") });
      await stratum.migrateRegion(childId, region.id);
      const client = await operatorClient();

      const err = await client.deleteRegion(region.id).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RegionInUseError);
      expect((err as RegionInUseError).details).toEqual({ region_id: region.id });
    });
  });

  it("maps a purge by a key without the admin scope to ForbiddenError", async () => {
    const key = await stratum.createApiKey(parentId);
    await getPool().query("UPDATE api_keys SET scopes = $2 WHERE id = $1", [key.id, ["read", "write"]]);
    const client = new StratumClient({ controlPlaneUrl: baseUrl, apiKey: key.plaintext_key, cache: { enabled: false } });

    await expect(client.purgeTenant(childId)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await stratum.getTenant(childId)).id).toBe(childId);
  });
});

/** Run the Express middleware for one tenant and return the status it sent, if any. */
async function middlewareStatus(client: StratumClient, tenantId: string): Promise<number | undefined> {
  const mw = expressMiddleware(client);
  let status: number | undefined;
  let nextErr: unknown;
  await mw(
    { headers: { "x-tenant-id": tenantId } },
    { status: (code: number) => { status = code; return { json: () => undefined }; } },
    (err?: unknown) => { nextErr = err; },
  );
  expect(nextErr).toBeUndefined();
  return status;
}
