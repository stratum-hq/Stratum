import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Stratum } from "@stratum-hq/lib";
import { createMockStratum, buildTestApp, authHeaders } from "./test-helpers.js";

/**
 * The batch-create guard authorizes each entry's parent for a scoped key. It
 * must bound that work: an oversized batch is refused before any parent is
 * looked up, and each distinct parent is looked up once.
 */

const OWNER = "11111111-1111-4111-8111-111111111111";
const OWNER_CHILD = "22222222-2222-4222-8222-222222222222";

const TENANTS: Record<string, { id: string; ancestry_path: string; status: string }> = {
  [OWNER]: { id: OWNER, ancestry_path: "", status: "active" },
  [OWNER_CHILD]: { id: OWNER_CHILD, ancestry_path: OWNER, status: "active" },
};

let app: FastifyInstance;
let stratum: Stratum;

function entries(n: number) {
  return Array.from({ length: n }, (_, i) => ({ name: `t${i}`, slug: `t_${i}`, parent_id: OWNER_CHILD }));
}

beforeEach(async () => {
  stratum = createMockStratum();
  (stratum.validateApiKey as ReturnType<typeof vi.fn>).mockResolvedValue({
    key_id: "scoped-key",
    tenant_id: OWNER,
    scopes: ["read", "write"],
    rate_limit_max: null,
    rate_limit_window: null,
  });
  (stratum.getTenant as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) => {
    const row = TENANTS[id];
    if (!row) throw new Error(`Tenant ${id} not found`);
    return row;
  });
  (stratum.batchCreateTenants as ReturnType<typeof vi.fn>).mockResolvedValue({ succeeded: [], failed: [] });
  app = await buildTestApp(stratum);
});

describe("batch tenant create guard bounds its authorization work", () => {
  it("refuses a batch over the size limit before looking up any parent", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/tenants/batch",
      headers: authHeaders(),
      payload: { tenants: entries(500) },
    });
    expect(res.statusCode).toBe(400);
    expect(stratum.getTenant).not.toHaveBeenCalled();
  });

  it("looks up each distinct parent once", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/tenants/batch",
      headers: authHeaders(),
      payload: { tenants: entries(100) },
    });
    expect(res.statusCode).toBe(201);
    expect(stratum.getTenant).toHaveBeenCalledTimes(1);
  });
});
