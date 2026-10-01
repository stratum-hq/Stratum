import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Stratum } from "@stratum-hq/lib";
import { getPool, closePool, runMigrations, cleanTestData } from "./helpers/db.js";
import { uniqueSlug } from "./helpers/fixtures.js";

// A sensitive config value set on a parent is inherited by its descendants for
// trusted server-side use. Reads of a descendant's config return it masked,
// unless the caller asks the library to reveal it or, over the API, the
// caller's key belongs to the tenant that set it. Driven against real Postgres
// and the real control-plane app.

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "integration-test-jwt-secret";
process.env.RATE_LIMIT_MAX = "1000";

type ControlPlaneApp = typeof import("../../control-plane/dist/app.js");
type ControlPlaneDb = typeof import("../../control-plane/dist/db/connection.js");

const SECRET = "parent-only-secret-value";
const LOCKED_SECRET = "locked-parent-secret-value";
const CHILD_SECRET = "child-own-secret-value";

let app: Awaited<ReturnType<ControlPlaneApp["buildApp"]>>;
let cpDb: ControlPlaneDb;
let stratum: Stratum;
let parentId: string;
let childId: string;

async function makeKey(tenantId: string, scopes: string[], global = false): Promise<string> {
  const created = await stratum.createApiKey(tenantId);
  await getPool().query("UPDATE api_keys SET scopes = $2 WHERE id = $1", [created.id, scopes]);
  if (global) {
    await getPool().query("UPDATE api_keys SET tenant_id = NULL WHERE id = $1", [created.id]);
  }
  return created.plaintext_key;
}

type ConfigBody = Record<string, { value: unknown; masked?: boolean }>;
type ContextBody = { tenant_id: string; resolved_config: ConfigBody };

async function getJson<T = ConfigBody>(url: string, key: string): Promise<{ status: number; body: T }> {
  const res = await app.inject({ method: "GET", url, headers: { "x-api-key": key } });
  return { status: res.statusCode, body: res.json<T>() };
}

describe("sensitive config inheritance is masked (integration)", () => {
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
    const parent = await stratum.createTenant({ name: "Parent", slug: uniqueSlug("mask_p") });
    const child = await stratum.createTenant({ name: "Child", slug: uniqueSlug("mask_c"), parent_id: parent.id });
    parentId = parent.id;
    childId = child.id;
    await stratum.setConfig(parentId, "api_secret", { value: SECRET, sensitive: true });
    await stratum.setConfig(parentId, "locked_secret", { value: LOCKED_SECRET, sensitive: true, locked: true });
    await stratum.setConfig(parentId, "max_users", { value: 50 });
    await stratum.setConfig(childId, "own_secret", { value: CHILD_SECRET, sensitive: true });
  });

  // --- library ---

  it("resolveConfig masks a parent's sensitive values in a child by default", async () => {
    const resolved = await stratum.resolveConfig(childId);

    expect(resolved.api_secret).toEqual({
      key: "api_secret",
      value: null,
      source_tenant_id: parentId,
      inherited: true,
      locked: false,
      sensitive: true,
      masked: true,
    });
    expect(resolved.locked_secret).toMatchObject({ value: null, masked: true, locked: true });
    expect(resolved.max_users.value).toBe(50);
    expect(resolved.own_secret).toMatchObject({ value: CHILD_SECRET, sensitive: true });
    expect(JSON.stringify(resolved)).not.toContain(SECRET);
    expect(JSON.stringify(resolved)).not.toContain(LOCKED_SECRET);
  });

  it("resolveConfig reveals inherited sensitive values with revealSensitive", async () => {
    const resolved = await stratum.resolveConfig(childId, { revealSensitive: true });

    expect(resolved.api_secret.value).toBe(SECRET);
    expect(resolved.api_secret.masked).toBeUndefined();
    expect(resolved.locked_secret.value).toBe(LOCKED_SECRET);
  });

  it("resolveConfig reveals an inherited sensitive value to the tenant that set it", async () => {
    const asParent = await stratum.resolveConfig(childId, { viewerTenantId: parentId });
    const asChild = await stratum.resolveConfig(childId, { viewerTenantId: childId });

    expect(asParent.api_secret.value).toBe(SECRET);
    expect(asChild.api_secret.value).toBeNull();
    expect(asChild.api_secret.masked).toBe(true);
  });

  it("resolveConfig returns the owning tenant's own sensitive value decrypted", async () => {
    const resolved = await stratum.resolveConfig(parentId);

    expect(resolved.api_secret.value).toBe(SECRET);
    expect(resolved.api_secret.sensitive).toBe(true);
  });

  it("getConfigWithInheritance and getTenantContext mask inherited sensitive values by default", async () => {
    const inheritance = await stratum.getConfigWithInheritance(childId);
    const context = await stratum.getTenantContext(childId);

    expect(inheritance.api_secret).toMatchObject({ value: null, masked: true });
    expect(context.config.api_secret).toMatchObject({ value: null, masked: true });
    expect(JSON.stringify(inheritance)).not.toContain(SECRET);
    expect(JSON.stringify(context)).not.toContain(SECRET);
  });

  it("computeDrift reports a masked locked value as in sync", async () => {
    const drift = await stratum.computeDrift(parentId, childId);

    const locked = drift.details.find((detail) => detail.key === "locked_secret");
    expect(locked?.status).toBe("ok");
    expect(drift.status).not.toBe("conflict");
  });

  // --- control plane ---

  it("a child read key gets the parent's sensitive value masked from the config route", async () => {
    const key = await makeKey(childId, ["read"]);

    const { status, body } = await getJson(`/api/v1/tenants/${childId}/config`, key);

    expect(status).toBe(200);
    expect(body.api_secret).toMatchObject({ value: null, masked: true, sensitive: true, source_tenant_id: parentId });
    expect(body.own_secret.value).toBe(CHILD_SECRET);
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  it("a child read key resolves its context, with inherited sensitive values masked", async () => {
    const key = await makeKey(childId, ["read"]);

    const { status, body } = await getJson<ContextBody>(`/api/v1/tenants/${childId}/context`, key);

    expect(status).toBe(200);
    expect(body.tenant_id).toBe(childId);
    expect(body.resolved_config.api_secret).toMatchObject({ value: null, masked: true });
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  it("a child read key cannot resolve its parent's context", async () => {
    const key = await makeKey(childId, ["read"]);

    const { status } = await getJson(`/api/v1/tenants/${parentId}/context`, key);

    expect(status).toBe(403);
  });

  it("a child key gets inherited sensitive values masked from the inheritance and diff routes", async () => {
    const grandchild = await stratum.createTenant({ name: "Grandchild", slug: uniqueSlug("mask_g"), parent_id: childId });
    const key = await makeKey(childId, ["read"]);

    const inheritance = await getJson(`/api/v1/tenants/${childId}/config/inheritance`, key);
    const diff = await getJson(`/api/v1/config/diff?tenant_a=${childId}&tenant_b=${grandchild.id}`, key);

    expect(inheritance.status).toBe(200);
    expect(diff.status).toBe(200);
    expect(JSON.stringify(inheritance.body)).not.toContain(SECRET);
    expect(JSON.stringify(diff.body)).not.toContain(SECRET);
  });

  it("the parent's key sees its own sensitive value in the child's config", async () => {
    const key = await makeKey(parentId, ["read"]);

    const { status, body } = await getJson(`/api/v1/tenants/${childId}/config`, key);

    expect(status).toBe(200);
    expect(body.api_secret.value).toBe(SECRET);
    expect(body.api_secret.masked).toBeUndefined();
  });

  it("a global key gets inherited sensitive values masked in a child's config", async () => {
    const key = await makeKey(parentId, ["read", "write", "admin"], true);

    const child = await getJson(`/api/v1/tenants/${childId}/config`, key);
    const parent = await getJson(`/api/v1/tenants/${parentId}/config`, key);

    expect(child.body.api_secret).toMatchObject({ value: null, masked: true });
    expect(parent.body.api_secret.value).toBe(SECRET);
  });
});
