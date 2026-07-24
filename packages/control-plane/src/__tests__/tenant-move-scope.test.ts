import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Stratum } from "@stratum-hq/lib";
import { createMockStratum, buildTestApp, authHeaders } from "./test-helpers.js";

/**
 * Regression tests for a critical cross-tenant authorization flaw in the move route.
 *
 * The bug: createTenantScopeGuard was registered with the `fromParamId` extractor,
 * which reads only `:id`, the tenant being MOVED. Nothing authorized
 * `body.new_parent_id`, the move DESTINATION.
 *
 * A key scoped to its own tenant therefore passed the guard on the fast path
 * (`apiKey.tenant_id === targetTenantId`) and could graft itself under any tenant
 * in the system. Because Stratum resolves config by walking UP the ancestry path,
 * the attacker's tenant then inherits the victim's config, including `sensitive`
 * values, which are decrypted on resolve, plus the victim's delegated permissions.
 *
 * The library's moveTenant is not at fault: it locks both rows, rejects archived
 * tenants and detects cycles. Authorization is the control plane's job.
 */

const ATTACKER = "11111111-1111-4111-8111-111111111111";
const ATTACKER_CHILD = "22222222-2222-4222-8222-222222222222";
const ATTACKER_GRANDCHILD = "33333333-3333-4333-8333-333333333333";
const VICTIM = "99999999-9999-4999-8999-999999999999";

type Row = { id: string; ancestry_path: string; status: string };

// ancestry_path holds a tenant's ANCESTORS and excludes self, so a root is "".
const TENANTS: Record<string, Row> = {
  [ATTACKER]: { id: ATTACKER, ancestry_path: "", status: "active" },
  [ATTACKER_CHILD]: {
    id: ATTACKER_CHILD,
    ancestry_path: ATTACKER,
    status: "active",
  },
  [ATTACKER_GRANDCHILD]: {
    id: ATTACKER_GRANDCHILD,
    ancestry_path: `${ATTACKER}/${ATTACKER_CHILD}`,
    status: "active",
  },
  [VICTIM]: { id: VICTIM, ancestry_path: "", status: "active" },
};

let app: FastifyInstance;
let stratum: Stratum;

beforeEach(async () => {
  stratum = createMockStratum();

  // A key scoped to the attacker's own tenant. Not a global key.
  (stratum.validateApiKey as ReturnType<typeof vi.fn>).mockResolvedValue({
    key_id: "attacker-key",
    tenant_id: ATTACKER,
    scopes: ["read", "write", "admin"],
    rate_limit_max: null,
    rate_limit_window: null,
  });

  (stratum.getTenant as ReturnType<typeof vi.fn>).mockImplementation(
    async (id: string) => {
      const row = TENANTS[id];
      if (!row) throw new Error(`Tenant ${id} not found`);
      return row;
    },
  );

  (stratum.moveTenant as ReturnType<typeof vi.fn>).mockImplementation(
    async (id: string) => TENANTS[id],
  );

  app = await buildTestApp(stratum);
});

async function move(id: string, newParentId: string) {
  return app.inject({
    method: "POST",
    url: `/api/v1/tenants/${id}/move`,
    headers: { ...authHeaders(), "content-type": "application/json" },
    payload: { new_parent_id: newParentId },
  });
}

describe("move route authorizes the destination parent, not just the moved tenant", () => {
  it("refuses grafting your own tenant under an unrelated tenant", async () => {
    const res = await move(ATTACKER, VICTIM);

    expect(res.statusCode).toBe(403);
    expect(stratum.moveTenant).not.toHaveBeenCalled();
  });

  it("refuses grafting a tenant you do own under a tenant you do not", async () => {
    const res = await move(ATTACKER_CHILD, VICTIM);

    expect(res.statusCode).toBe(403);
    expect(stratum.moveTenant).not.toHaveBeenCalled();
  });

  it("allows reorganizing entirely inside your own subtree", async () => {
    const res = await move(ATTACKER_GRANDCHILD, ATTACKER_CHILD);

    expect(res.statusCode).toBe(200);
    expect(stratum.moveTenant).toHaveBeenCalledWith(
      ATTACKER_GRANDCHILD,
      ATTACKER_CHILD,
      expect.anything(),
    );
  });

  it("allows moving a descendant up to your own root", async () => {
    const res = await move(ATTACKER_GRANDCHILD, ATTACKER);

    expect(res.statusCode).toBe(200);
    expect(stratum.moveTenant).toHaveBeenCalled();
  });

  it("fails closed when the destination tenant cannot be loaded", async () => {
    const res = await move(ATTACKER, "44444444-4444-4444-8444-444444444444");

    expect(res.statusCode).toBe(403);
    expect(stratum.moveTenant).not.toHaveBeenCalled();
  });
});

describe("global keys are unaffected", () => {
  beforeEach(async () => {
    (stratum.validateApiKey as ReturnType<typeof vi.fn>).mockResolvedValue({
      key_id: "global-key",
      tenant_id: null,
      scopes: ["read", "write", "admin"],
      rate_limit_max: null,
      rate_limit_window: null,
    });
    app = await buildTestApp(stratum);
  });

  it("still permits an operator key to move a tenant anywhere", async () => {
    const res = await move(ATTACKER, VICTIM);

    expect(res.statusCode).toBe(200);
    expect(stratum.moveTenant).toHaveBeenCalled();
  });
});
