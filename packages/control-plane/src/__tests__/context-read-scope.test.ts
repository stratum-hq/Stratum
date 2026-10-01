import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Mock } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Stratum } from "@stratum-hq/lib";
import { TenantNotFoundError } from "@stratum-hq/core";
import {
  createMockStratum,
  buildTestApp,
  authHeaders,
  setupAdminApiKey,
  setupReadOnlyApiKey,
  SAMPLE_TENANT,
  SAMPLE_CHILD_TENANT,
} from "./test-helpers.js";

/**
 * GET /tenants/:id/context is what the SDK resolveTenant, the Express and
 * Fastify middleware, the NestJS guard and the Hono resolve call on every
 * request. It is a read: a read-scoped key may resolve the context of any
 * tenant its key scope reaches, so an app server does not need an admin key.
 */

const OTHER_ROOT = {
  ...SAMPLE_TENANT,
  id: "660e8400-e29b-41d4-a716-446655440000",
  slug: "other_root",
  ancestry_path: "/660e8400-e29b-41d4-a716-446655440000",
};

function setupScopedKey(stratum: Stratum, tenantId: string, scopes: string[]): void {
  (stratum.validateApiKey as Mock).mockResolvedValue({
    key_id: "scoped-key",
    tenant_id: tenantId,
    scopes,
    rate_limit_max: null,
    rate_limit_window: null,
  });
}

function getTenantContextMock(stratum: Stratum): Mock {
  return (stratum as unknown as { getTenantContext: Mock }).getTenantContext;
}

describe("GET /api/v1/tenants/:id/context required scope", () => {
  let app: FastifyInstance;
  let stratum: Stratum;

  beforeEach(async () => {
    stratum = createMockStratum();
    (stratum as unknown as { getTenantContext: Mock }).getTenantContext = vi.fn(
      async (id: string) => ({
        tenant: id === SAMPLE_CHILD_TENANT.id ? SAMPLE_CHILD_TENANT : SAMPLE_TENANT,
        config: {},
        permissions: {},
        ancestors: [],
      }),
    );
    (stratum.getTenant as Mock).mockImplementation(async (id: string) => {
      if (id === SAMPLE_TENANT.id) return { ...SAMPLE_TENANT, status: "active" };
      if (id === SAMPLE_CHILD_TENANT.id) return { ...SAMPLE_CHILD_TENANT, status: "active" };
      if (id === OTHER_ROOT.id) return { ...OTHER_ROOT, status: "active" };
      throw new TenantNotFoundError(id);
    });
    app = await buildTestApp(stratum);
  });

  afterEach(async () => {
    await app.close();
  });

  it("allows a read-scoped key to resolve its own tenant's context", async () => {
    setupScopedKey(stratum, SAMPLE_TENANT.id, ["read"]);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/tenants/${SAMPLE_TENANT.id}/context`,
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().tenant_id).toBe(SAMPLE_TENANT.id);
  });

  it("allows a read-scoped key to resolve a descendant's context", async () => {
    setupScopedKey(stratum, SAMPLE_TENANT.id, ["read"]);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/tenants/${SAMPLE_CHILD_TENANT.id}/context`,
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().tenant_id).toBe(SAMPLE_CHILD_TENANT.id);
  });

  it("refuses a read-scoped key on a tenant outside its subtree", async () => {
    setupScopedKey(stratum, SAMPLE_CHILD_TENANT.id, ["read"]);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/tenants/${OTHER_ROOT.id}/context`,
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(403);
    expect(getTenantContextMock(stratum)).not.toHaveBeenCalled();
  });

  it("refuses a read-scoped key on its parent's context", async () => {
    setupScopedKey(stratum, SAMPLE_CHILD_TENANT.id, ["read"]);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/tenants/${SAMPLE_TENANT.id}/context`,
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(403);
    expect(getTenantContextMock(stratum)).not.toHaveBeenCalled();
  });

  it("allows a global read-scoped key to resolve any tenant's context", async () => {
    setupReadOnlyApiKey(stratum);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/tenants/${OTHER_ROOT.id}/context`,
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(200);
  });

  it("still allows an admin key to resolve a context", async () => {
    setupAdminApiKey(stratum);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/tenants/${SAMPLE_TENANT.id}/context`,
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(200);
  });
});

describe("scope refusal message", () => {
  let app: FastifyInstance;
  let stratum: Stratum;

  beforeEach(async () => {
    stratum = createMockStratum();
    app = await buildTestApp(stratum);
  });

  afterEach(async () => {
    await app.close();
  });

  it("names the admin scope when a read-scoped key calls an admin route", async () => {
    setupReadOnlyApiKey(stratum);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/tenants/${SAMPLE_TENANT.id}/export`,
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toContain('requires the "admin" scope');
  });

  it("names the write scope when a read-scoped key calls a write route", async () => {
    setupReadOnlyApiKey(stratum);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/tenants/${SAMPLE_TENANT.id}`,
      headers: authHeaders(),
      payload: { name: "x" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toContain('requires the "write" scope');
  });
});
