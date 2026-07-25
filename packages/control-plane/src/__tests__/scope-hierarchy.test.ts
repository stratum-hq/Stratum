import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Stratum } from "@stratum-hq/lib";
import {
  createMockStratum,
  buildTestApp,
  authHeaders,
  SAMPLE_TENANT,
} from "./test-helpers.js";

/**
 * Hierarchical scope contract (Decision 3a): read < write < admin. A granted
 * scope satisfies any required scope of equal-or-lower rank, so admin implies
 * write implies read. This drives the REAL authorize middleware end to end.
 *
 * Keys here carry a SINGLE, non-cumulative scope (["admin"] only, ["write"]
 * only, ["read"] only) — the exact shape a flat `scopes.includes(required)`
 * check gets wrong. Every cell tagged FLIP is denied (403) by the old flat code
 * and allowed by the hierarchical contract; the deny cells are unchanged
 * controls (a lower scope never satisfies a higher requirement).
 *
 * The key is a global operator (tenant_id null) so the tenant-scope enforcer is
 * a no-op and each cell exercises the scope check alone.
 */

const id = SAMPLE_TENANT.id;

/** Accept the test key with exactly `scopes`, as a global (tenant-null) key. */
function setupKeyWithScopes(stratum: Stratum, scopes: string[]): void {
  (stratum.validateApiKey as ReturnType<typeof vi.fn>).mockResolvedValue({
    key_id: "hier-key",
    tenant_id: null,
    scopes,
    rate_limit_max: null,
    rate_limit_window: null,
  });
}

interface RouteUnderTest {
  required: "read" | "write" | "admin";
  method: "GET" | "PATCH" | "POST";
  url: string;
  body?: unknown;
  guarded: keyof Stratum;
  okStatus: number;
}

const READ_ROUTE: RouteUnderTest = {
  required: "read",
  method: "GET",
  url: `/api/v1/tenants/${id}/config`,
  guarded: "resolveConfig",
  okStatus: 200,
};
const WRITE_ROUTE: RouteUnderTest = {
  required: "write",
  method: "PATCH",
  url: `/api/v1/tenants/${id}`,
  body: { name: "renamed" },
  guarded: "updateTenant",
  okStatus: 200,
};
const ADMIN_ROUTE: RouteUnderTest = {
  required: "admin",
  method: "POST",
  url: `/api/v1/tenants/${id}/purge`,
  guarded: "purgeTenant",
  okStatus: 204,
};

const ROUTES = [READ_ROUTE, WRITE_ROUTE, ADMIN_ROUTE];

interface ScopeCase {
  scope: "read" | "write" | "admin";
  // Expected outcome per required route level, and whether it flips vs flat.
  satisfies: Record<"read" | "write" | "admin", boolean>;
}

const CASES: ScopeCase[] = [
  { scope: "admin", satisfies: { read: true, write: true, admin: true } },
  { scope: "write", satisfies: { read: true, write: true, admin: false } },
  { scope: "read", satisfies: { read: true, write: false, admin: false } },
];

describe("hierarchical API-key scopes (admin > write > read)", () => {
  let app: FastifyInstance;
  let stratum: Stratum;

  beforeEach(async () => {
    stratum = createMockStratum();
    (stratum.getTenant as ReturnType<typeof vi.fn>).mockResolvedValue(SAMPLE_TENANT);
    (stratum.resolveConfig as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (stratum.updateTenant as ReturnType<typeof vi.fn>).mockResolvedValue(SAMPLE_TENANT);
    (stratum.purgeTenant as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    app = await buildTestApp(stratum);
  });

  afterEach(async () => {
    await app.close();
  });

  for (const { scope, satisfies } of CASES) {
    for (const route of ROUTES) {
      const allowed = satisfies[route.required];
      const label = allowed ? "satisfies" : "does not satisfy";
      it(`[${scope}] key ${label} a ${route.required} route`, async () => {
        setupKeyWithScopes(stratum, [scope]);

        const headers = authHeaders();
        if (route.body !== undefined) headers["content-type"] = "application/json";

        const res = await app.inject({
          method: route.method,
          url: route.url,
          headers,
          payload: route.body !== undefined ? JSON.stringify(route.body) : undefined,
        });

        const guard = stratum[route.guarded] as ReturnType<typeof vi.fn>;
        if (allowed) {
          expect(
            res.statusCode,
            `[${scope}] on ${route.required} route expected allow, got ${res.statusCode}: ${res.body}`,
          ).toBe(route.okStatus);
          expect(guard).toHaveBeenCalled();
        } else {
          expect(res.statusCode).toBe(403);
          expect(guard).not.toHaveBeenCalled();
        }
      });
    }
  }
});
