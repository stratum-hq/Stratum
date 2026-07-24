import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Stratum } from "@stratum-hq/lib";
import { createMockStratum, buildTestApp, authHeaders } from "./test-helpers.js";

/**
 * Tenant creation must respect the caller's key scope.
 *
 * A tenant-scoped key may only create tenants WITHIN its own subtree: the new
 * tenant's parent must be the key's own tenant or a descendant of it. A scoped
 * key may not create a new root (a tenant with no parent). Only global
 * (operator) keys may create roots or create anywhere in the tree.
 */

const OWNER = "11111111-1111-4111-8111-111111111111";
const OWNER_CHILD = "22222222-2222-4222-8222-222222222222";
const OUTSIDER = "99999999-9999-4999-8999-999999999999";

type Row = { id: string; ancestry_path: string; status: string };

// ancestry_path holds a tenant's ANCESTORS and excludes self, so a root is "".
const TENANTS: Record<string, Row> = {
  [OWNER]: { id: OWNER, ancestry_path: "", status: "active" },
  [OWNER_CHILD]: { id: OWNER_CHILD, ancestry_path: OWNER, status: "active" },
  [OUTSIDER]: { id: OUTSIDER, ancestry_path: "", status: "active" },
};

let app: FastifyInstance;
let stratum: Stratum;

function useScopedKey() {
  (stratum.validateApiKey as ReturnType<typeof vi.fn>).mockResolvedValue({
    key_id: "scoped-key",
    tenant_id: OWNER,
    scopes: ["read", "write", "admin"],
    rate_limit_max: null,
    rate_limit_window: null,
  });
}

function useGlobalKey() {
  (stratum.validateApiKey as ReturnType<typeof vi.fn>).mockResolvedValue({
    key_id: "global-key",
    tenant_id: null,
    scopes: ["read", "write", "admin"],
    rate_limit_max: null,
    rate_limit_window: null,
  });
}

beforeEach(async () => {
  stratum = createMockStratum();

  (stratum.getTenant as ReturnType<typeof vi.fn>).mockImplementation(
    async (id: string) => {
      const row = TENANTS[id];
      if (!row) throw new Error(`Tenant ${id} not found`);
      return row;
    },
  );

  (stratum.createTenant as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "created-id",
    slug: "newco",
    isolation_strategy: "SHARED_RLS",
  });
  (stratum.batchCreateTenants as ReturnType<typeof vi.fn>).mockResolvedValue({
    created: [],
  });

  app = await buildTestApp(stratum);
});

async function create(body: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/api/v1/tenants",
    headers: { ...authHeaders(), "content-type": "application/json" },
    payload: body,
  });
}

describe("scoped key create is confined to its own subtree", () => {
  beforeEach(useScopedKey);

  it("refuses creating a tenant under a parent outside the key subtree", async () => {
    const res = await create({ slug: "newco", name: "New Co", parent_id: OUTSIDER });

    expect(res.statusCode).toBe(403);
    expect(stratum.createTenant).not.toHaveBeenCalled();
  });

  it("refuses creating a new root tenant (no parent)", async () => {
    const res = await create({ slug: "newco", name: "New Co" });

    expect(res.statusCode).toBe(403);
    expect(stratum.createTenant).not.toHaveBeenCalled();
  });

  it("refuses an explicit null parent (root)", async () => {
    const res = await create({ slug: "newco", name: "New Co", parent_id: null });

    expect(res.statusCode).toBe(403);
    expect(stratum.createTenant).not.toHaveBeenCalled();
  });

  it("allows creating directly under the key's own tenant", async () => {
    const res = await create({ slug: "newco", name: "New Co", parent_id: OWNER });

    expect(res.statusCode).toBe(201);
    expect(stratum.createTenant).toHaveBeenCalled();
  });

  it("allows creating under a descendant of the key's tenant", async () => {
    const res = await create({ slug: "newco", name: "New Co", parent_id: OWNER_CHILD });

    expect(res.statusCode).toBe(201);
    expect(stratum.createTenant).toHaveBeenCalled();
  });

  it("refuses a batch create that targets a parent outside the subtree", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/tenants/batch",
      headers: { ...authHeaders(), "content-type": "application/json" },
      payload: { tenants: [{ slug: "newco", name: "New Co", parent_id: OUTSIDER }] },
    });

    expect(res.statusCode).toBe(403);
    expect(stratum.batchCreateTenants).not.toHaveBeenCalled();
  });

  it("refuses a batch create that includes a new root", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/tenants/batch",
      headers: { ...authHeaders(), "content-type": "application/json" },
      payload: { tenants: [{ slug: "newco", name: "New Co", parent_id: OWNER }, { slug: "rootco", name: "Root Co" }] },
    });

    expect(res.statusCode).toBe(403);
    expect(stratum.batchCreateTenants).not.toHaveBeenCalled();
  });
});

describe("global key create is unrestricted", () => {
  beforeEach(useGlobalKey);

  it("allows creating a new root tenant", async () => {
    const res = await create({ slug: "rootco", name: "Root Co" });

    expect(res.statusCode).toBe(201);
    expect(stratum.createTenant).toHaveBeenCalled();
  });

  it("allows creating anywhere in the tree", async () => {
    const res = await create({ slug: "newco", name: "New Co", parent_id: OUTSIDER });

    expect(res.statusCode).toBe(201);
    expect(stratum.createTenant).toHaveBeenCalled();
  });
});
