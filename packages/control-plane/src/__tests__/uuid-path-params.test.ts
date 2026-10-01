import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance, RouteOptions } from "fastify";

/**
 * Every route with an id in its path answers a value that is not a UUID with
 * 400 VALIDATION_ERROR, before any library call. Without the check the value
 * reaches PostgreSQL, which refuses it, and the caller gets a 500.
 *
 * The test enumerates every route the real buildApp() registers, so a new
 * route with an id parameter is covered without a change here.
 */

const registered: RouteOptions[] = [];

vi.mock("fastify", async (importOriginal) => {
  const mod = await importOriginal<typeof import("fastify")>();
  const factory = ((opts: Parameters<typeof mod.default>[0]) => {
    const app = mod.default({ ...opts, logger: false });
    app.addHook("onRoute", (route) => {
      registered.push(route);
    });
    return app;
  }) as unknown as typeof mod.default;
  return { ...mod, default: factory };
});

// A library stand-in: the key check accepts an operator key, and every other
// call fails the way PostgreSQL fails on a malformed uuid.
const libCalls = vi.hoisted(() => [] as string[]);
vi.mock("@stratum-hq/lib", () => {
  class Stratum {
    constructor() {
      return new Proxy(this, {
        get(_target, prop) {
          if (prop === "then") return undefined;
          if (prop === "validateApiKey") {
            return async () => ({
              key_id: "operator-key",
              tenant_id: null,
              scopes: ["read", "write", "admin"],
              rate_limit_max: null,
              rate_limit_window: null,
            });
          }
          return async () => {
            libCalls.push(String(prop));
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
// Path parameters that are not ids. A new parameter name must be added to one list or the other.
const FREE_TEXT_PARAMS = new Set(["key", "purpose"]);

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
  libCalls.length = 0;
});

function paramNames(url: string): string[] {
  return [...url.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
}

/** One case per route, method and id parameter: that id is bad, the others are good. */
function cases(): Array<[string, string, string, string]> {
  const out: Array<[string, string, string, string]> = [];
  for (const route of registered) {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      if (method === "OPTIONS") continue;
      for (const bad of paramNames(route.url).filter((name) => !FREE_TEXT_PARAMS.has(name))) {
        const url = route.url.replace(/:([A-Za-z0-9_]+)/g, (_m, name: string) =>
          name === bad ? BAD_ID : FREE_TEXT_PARAMS.has(name) ? "some.key" : GOOD_ID,
        );
        out.push([method, route.url, bad, url]);
      }
    }
  }
  return out;
}

describe("UUID path parameters", () => {
  it("covers every id parameter of the real app", () => {
    const names = new Set(registered.flatMap((route) => paramNames(route.url)));
    const ids = [...names].filter((name) => !FREE_TEXT_PARAMS.has(name)).sort();
    expect(ids).toEqual(["deliveryId", "id", "keyId", "policyId", "tenantId"]);
    expect(cases().length).toBeGreaterThan(50);
  });

  it("answers 400 VALIDATION_ERROR for a non-UUID id on every route, before any library call", async () => {
    const failures: string[] = [];
    for (const [method, routeUrl, param, url] of cases()) {
      libCalls.length = 0;
      const res = await app.inject({
        method: method as "GET",
        url,
        headers: { "x-api-key": "sk_test_operator" },
        ...(["POST", "PUT", "PATCH"].includes(method) ? { payload: {} } : {}),
      });
      const body = method === "HEAD" ? undefined : res.json();
      const ok =
        res.statusCode === 400 &&
        libCalls.length === 0 &&
        (body === undefined ||
          (body?.error?.code === "VALIDATION_ERROR" &&
            JSON.stringify(body?.error?.details?.issues) ===
              JSON.stringify([{ path: ["params", param], message: "Invalid uuid", code: "invalid_string" }])));
      if (!ok) failures.push(`${method} ${routeUrl} (${param}): ${res.statusCode} ${res.body} calls=${libCalls.join(",")}`);
    }
    expect(failures).toEqual([]);
  });

  it("answers 401 to a caller without credentials, even when the id is bad", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/tenants/${BAD_ID}` });
    expect(res.statusCode).toBe(401);
  });

  it("passes a valid UUID through to the library", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/roles/${GOOD_ID}`,
      headers: { "x-api-key": "sk_test_operator" },
    });
    expect(libCalls).toContain("getRole");
    expect(res.statusCode).toBe(500);
  });
});

describe("unmatched routes in the real app", () => {
  it("answers 404 with the error envelope to an authenticated caller", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/does-not-exist",
      headers: { "x-api-key": "sk_test_operator" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Route GET /api/v1/does-not-exist not found" },
    });
  });

  it("answers 401 to a caller without credentials", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/does-not-exist" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });
});
