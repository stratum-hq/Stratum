import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Mock } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Stratum } from "@stratum-hq/lib";
import {
  createMockStratum,
  buildTestApp,
  authHeaders,
  setupAdminApiKey,
  SAMPLE_TENANT,
  SAMPLE_CHILD_TENANT,
} from "./test-helpers.js";

/**
 * Config reads over the API never reveal a sensitive value inherited from an
 * ancestor unless the caller's key belongs to the tenant that set it. The
 * routes pass the caller's tenant to the library as `viewerTenantId` and never
 * ask it to reveal everything.
 */

const PARENT = SAMPLE_TENANT.id;
const CHILD = SAMPLE_CHILD_TENANT.id;
const GRANDCHILD = "550e8400-e29b-41d4-a716-446655440002";
const GRANDCHILD_TENANT = {
  ...SAMPLE_CHILD_TENANT,
  id: GRANDCHILD,
  parent_id: CHILD,
  ancestry_path: `${SAMPLE_CHILD_TENANT.ancestry_path}/${GRANDCHILD}`,
  depth: 2,
};

function setupScopedKey(stratum: Stratum, tenantId: string): void {
  (stratum.validateApiKey as Mock).mockResolvedValue({
    key_id: "scoped-key",
    tenant_id: tenantId,
    scopes: ["read"],
    rate_limit_max: null,
    rate_limit_window: null,
  });
}

function getTenantContextMock(stratum: Stratum): Mock {
  return (stratum as unknown as { getTenantContext: Mock }).getTenantContext;
}

const READS: Array<{
  name: string;
  url: (id: string) => string;
  method: (stratum: Stratum) => Mock;
  optionsArg: number;
}> = [
  {
    name: "GET /tenants/:id/config",
    url: (id) => `/api/v1/tenants/${id}/config`,
    method: (s) => s.resolveConfig as Mock,
    optionsArg: 1,
  },
  {
    name: "GET /tenants/:id/config/inheritance",
    url: (id) => `/api/v1/tenants/${id}/config/inheritance`,
    method: (s) => s.getConfigWithInheritance as Mock,
    optionsArg: 1,
  },
  {
    name: "GET /tenants/:id/context",
    url: (id) => `/api/v1/tenants/${id}/context`,
    method: (s) => getTenantContextMock(s),
    optionsArg: 1,
  },
  {
    name: "GET /config/diff",
    url: (id) => `/api/v1/config/diff?tenant_a=${id}&tenant_b=${GRANDCHILD}`,
    method: (s) => s.diffConfig as Mock,
    optionsArg: 2,
  },
];

describe.each(READS)("$name sensitive masking", ({ url, method, optionsArg }) => {
  let app: FastifyInstance;
  let stratum: Stratum;

  beforeEach(async () => {
    stratum = createMockStratum();
    (stratum as unknown as { getTenantContext: Mock }).getTenantContext = vi.fn();
    (stratum.getTenant as Mock).mockImplementation(async (id: string) => {
      if (id === GRANDCHILD) return { ...GRANDCHILD_TENANT, status: "active" };
      if (id === CHILD) return { ...SAMPLE_CHILD_TENANT, status: "active" };
      return { ...SAMPLE_TENANT, status: "active" };
    });
    (stratum.resolveConfig as Mock).mockResolvedValue({});
    (stratum.getConfigWithInheritance as Mock).mockResolvedValue({});
    (stratum.diffConfig as Mock).mockResolvedValue({ diff: [] });
    getTenantContextMock(stratum).mockResolvedValue({
      tenant: SAMPLE_CHILD_TENANT,
      config: {},
      permissions: {},
      ancestors: [],
    });
    app = await buildTestApp(stratum);
  });

  afterEach(async () => {
    await app.close();
  });

  it("reads as the caller's own tenant when a child key reads its own config", async () => {
    setupScopedKey(stratum, CHILD);

    const res = await app.inject({ method: "GET", url: url(CHILD), headers: authHeaders() });

    expect(res.statusCode).toBe(200);
    const options = method(stratum).mock.calls[0][optionsArg];
    expect(options).toEqual({ viewerTenantId: CHILD });
  });

  it("reads as the parent when a parent key reads a child's config", async () => {
    setupScopedKey(stratum, PARENT);

    const res = await app.inject({ method: "GET", url: url(CHILD), headers: authHeaders() });

    expect(res.statusCode).toBe(200);
    const options = method(stratum).mock.calls[0][optionsArg];
    expect(options).toEqual({ viewerTenantId: PARENT });
  });

  it("does not reveal inherited sensitive values to a global key", async () => {
    setupAdminApiKey(stratum);

    const res = await app.inject({ method: "GET", url: url(CHILD), headers: authHeaders() });

    expect(res.statusCode).toBe(200);
    const options = method(stratum).mock.calls[0][optionsArg];
    expect(options).toEqual({});
  });
});

describe("GET /tenants/:id/context response", () => {
  let app: FastifyInstance;
  let stratum: Stratum;

  beforeEach(async () => {
    stratum = createMockStratum();
    (stratum.getTenant as Mock).mockResolvedValue({ ...SAMPLE_CHILD_TENANT, status: "active" });
    (stratum as unknown as { getTenantContext: Mock }).getTenantContext = vi.fn().mockResolvedValue({
      tenant: SAMPLE_CHILD_TENANT,
      config: {
        api_secret: {
          key: "api_secret",
          value: null,
          source_tenant_id: PARENT,
          inherited: true,
          locked: false,
          sensitive: true,
          masked: true,
        },
      },
      permissions: {},
      ancestors: [],
    });
    app = await buildTestApp(stratum);
  });

  afterEach(async () => {
    await app.close();
  });

  it("passes a masked entry through with its marker", async () => {
    setupScopedKey(stratum, CHILD);

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/tenants/${CHILD}/context`,
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().resolved_config.api_secret).toMatchObject({
      value: null,
      sensitive: true,
      masked: true,
      source_tenant_id: PARENT,
    });
  });
});
