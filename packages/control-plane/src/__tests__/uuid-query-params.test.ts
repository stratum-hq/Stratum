import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * A tenant id read from the query string (tenant_id, tenant_a, tenant_b) that
 * is not a UUID gets 400 VALIDATION_ERROR before any library call. Without the
 * check the value reaches PostgreSQL, which refuses it, and the caller gets a 500.
 */

vi.mock("fastify", async (importOriginal) => {
  const mod = await importOriginal<typeof import("fastify")>();
  const factory = ((opts: Parameters<typeof mod.default>[0]) =>
    mod.default({ ...opts, logger: false })) as unknown as typeof mod.default;
  return { ...mod, default: factory };
});

// A library stand-in: the key check accepts the key in `currentKey`, and every
// other call fails the way PostgreSQL fails on a malformed uuid.
const state = vi.hoisted(() => ({
  libCalls: [] as string[],
  tenantId: null as string | null,
}));
vi.mock("@stratum-hq/lib", () => {
  class Stratum {
    constructor() {
      return new Proxy(this, {
        get(_target, prop) {
          if (prop === "then") return undefined;
          // buildApp() checks the role model once at startup.
          if (prop === "initialize") return async () => undefined;
          if (prop === "validateApiKey") {
            return async () => ({
              key_id: "test-key",
              tenant_id: state.tenantId,
              scopes: ["read", "write", "admin"],
              rate_limit_max: null,
              rate_limit_window: null,
            });
          }
          return async () => {
            state.libCalls.push(String(prop));
            throw new Error('invalid input syntax for type uuid: "not-a-uuid"');
          };
        },
      });
    }
  }
  return { Stratum };
});
vi.mock("../db/connection.js", () => ({ getPool: () => ({}), getAdminPool: () => undefined }));

const BAD_ID = "not-a-uuid";
const GOOD_ID = "550e8400-e29b-41d4-a716-446655440000";
const OTHER_ID = "550e8400-e29b-41d4-a716-446655440001";
const SCOPED_TENANT = "550e8400-e29b-41d4-a716-446655440002";

/** [route, query param, query string with that param bad and the others good] */
const CASES: Array<[string, string, string]> = [
  ["/api/v1/webhooks", "tenant_id", `tenant_id=${BAD_ID}`],
  ["/api/v1/api-keys", "tenant_id", `tenant_id=${BAD_ID}`],
  ["/api/v1/roles", "tenant_id", `tenant_id=${BAD_ID}`],
  ["/api/v1/audit-logs", "tenant_id", `tenant_id=${BAD_ID}`],
  ["/api/v1/config/diff", "tenant_a", `tenant_a=${BAD_ID}&tenant_b=${GOOD_ID}`],
  ["/api/v1/config/diff", "tenant_b", `tenant_a=${GOOD_ID}&tenant_b=${BAD_ID}`],
];

let app: FastifyInstance;

beforeAll(async () => {
  const { buildApp } = await import("../app.js");
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  state.libCalls.length = 0;
  state.tenantId = null;
});

function get(url: string) {
  return app.inject({ method: "GET", url, headers: { "x-api-key": "sk_test_key" } });
}

describe("UUID query-string tenant ids", () => {
  for (const scope of ["global", "tenant-scoped"] as const) {
    it.each(CASES)(`answers 400 VALIDATION_ERROR for a non-UUID on GET %s ?%s (${scope} key)`, async (route, param, query) => {
      state.tenantId = scope === "global" ? null : SCOPED_TENANT;
      const res = await get(`${route}?${query}`);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
      expect(res.json().error.details.issues).toEqual([
        { path: ["query", param], message: "Invalid uuid", code: "invalid_string" },
      ]);
      expect(state.libCalls).toEqual([]);
    });
  }

  it("answers 400 when a tenant id is given more than once", async () => {
    const res = await get(`/api/v1/roles?tenant_id=${GOOD_ID}&tenant_id=${OTHER_ID}`);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect(state.libCalls).toEqual([]);
  });

  it("answers 401 to a caller without credentials, even when the tenant id is bad", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/roles?tenant_id=${BAD_ID}` });
    expect(res.statusCode).toBe(401);
  });

  it.each([
    ["/api/v1/webhooks", `tenant_id=${GOOD_ID}`, "listWebhooks"],
    ["/api/v1/api-keys", `tenant_id=${GOOD_ID}`, "listApiKeys"],
    ["/api/v1/roles", `tenant_id=${GOOD_ID}`, "listRoles"],
    ["/api/v1/config/diff", `tenant_a=${GOOD_ID}&tenant_b=${OTHER_ID}`, "diffConfig"],
  ])("passes a valid UUID on GET %s through to the library", async (route, query, method) => {
    const res = await get(`${route}?${query}`);
    expect(state.libCalls).toContain(method);
    expect(res.statusCode).toBe(500);
  });

  it("leaves a request without a tenant id unchanged", async () => {
    await get("/api/v1/webhooks");
    expect(state.libCalls).toContain("listWebhooks");
  });
});
