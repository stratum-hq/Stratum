import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import type { FastifyInstance, RouteOptions } from "fastify";

/**
 * Every control-plane route must declare the scope it requires in its route
 * config. The authorize middleware refuses a route that declares none, so this
 * test enumerates every route the real app registers and checks each one.
 */

const registered: RouteOptions[] = [];

// Wrap the Fastify factory so an onRoute hook, added before any plugin or
// route, records every route the real buildApp() registers.
vi.mock("fastify", async (importOriginal) => {
  const mod = await importOriginal<typeof import("fastify")>();
  const factory = ((opts: Parameters<typeof mod.default>[0]) => {
    const app = mod.default(opts);
    app.addHook("onRoute", (route) => {
      registered.push(route);
    });
    return app;
  }) as unknown as typeof mod.default;
  return { ...mod, default: factory };
});

// Routes that carry no authentication: the health check, the OpenAPI docs, and
// the CORS preflight catch-all registered by @fastify/cors (preflight is
// answered before routing; anything else reaching it is refused by default).
function isExempt(url: string): boolean {
  return url === "/api/v1/health" || url.startsWith("/api/docs") || url === "*";
}

function routeKeys(): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [];
  for (const route of registered) {
    if (isExempt(route.url)) continue;
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      out.push([`${method} ${route.url}`, route.config?.requiredScope]);
    }
  }
  return out;
}

// The scope each route required before scopes were declared per route. Kept
// here so a change to any route's required scope is a visible, reviewed diff.
// Deliberate change since: GET /tenants/:id/context moved from admin to read,
// so an app server resolving tenants does not need an admin key.
const EXPECTED_SCOPES: Record<string, string> = Object.fromEntries([
    ["GET /api/v1/tenants/", "read"],
    ["HEAD /api/v1/tenants", "read"],
    ["HEAD /api/v1/tenants/", "read"],
    ["POST /api/v1/tenants/", "write"],
    ["POST /api/v1/tenants/batch", "write"],
    ["GET /api/v1/tenants/:id", "read"],
    ["HEAD /api/v1/tenants/:id", "read"],
    ["PATCH /api/v1/tenants/:id", "write"],
    ["DELETE /api/v1/tenants/:id", "write"],
    ["POST /api/v1/tenants/:id/move", "write"],
    ["POST /api/v1/tenants/:id/reorder", "write"],
    ["GET /api/v1/tenants/:id/ancestors", "read"],
    ["HEAD /api/v1/tenants/:id/ancestors", "read"],
    ["GET /api/v1/tenants/:id/descendants", "read"],
    ["HEAD /api/v1/tenants/:id/descendants", "read"],
    ["GET /api/v1/tenants/:id/children", "read"],
    ["HEAD /api/v1/tenants/:id/children", "read"],
    ["POST /api/v1/tenants/:id/migrate-region", "admin"],
    ["POST /api/v1/tenants/:id/purge", "admin"],
    ["GET /api/v1/tenants/:id/export", "admin"],
    ["HEAD /api/v1/tenants/:id/export", "admin"],
    ["GET /api/v1/tenants/:id/context", "read"],
    ["HEAD /api/v1/tenants/:id/context", "read"],
    ["GET /api/v1/tenants/:id/config/", "read"],
    ["HEAD /api/v1/tenants/:id/config", "read"],
    ["HEAD /api/v1/tenants/:id/config/", "read"],
    ["PUT /api/v1/tenants/:id/config/:key", "write"],
    ["DELETE /api/v1/tenants/:id/config/:key", "write"],
    ["PUT /api/v1/tenants/:id/config/batch", "write"],
    ["GET /api/v1/tenants/:id/config/inheritance", "read"],
    ["HEAD /api/v1/tenants/:id/config/inheritance", "read"],
    ["GET /api/v1/tenants/:id/permissions/", "read"],
    ["HEAD /api/v1/tenants/:id/permissions", "read"],
    ["HEAD /api/v1/tenants/:id/permissions/", "read"],
    ["POST /api/v1/tenants/:id/permissions/", "write"],
    ["PATCH /api/v1/tenants/:id/permissions/:policyId", "write"],
    ["DELETE /api/v1/tenants/:id/permissions/:policyId", "write"],
    ["POST /api/v1/api-keys/", "admin"],
    ["GET /api/v1/api-keys/", "admin"],
    ["HEAD /api/v1/api-keys", "admin"],
    ["HEAD /api/v1/api-keys/", "admin"],
    ["GET /api/v1/api-keys/dormant", "admin"],
    ["HEAD /api/v1/api-keys/dormant", "admin"],
    ["POST /api/v1/api-keys/:id/rotate", "admin"],
    ["DELETE /api/v1/api-keys/:id", "admin"],
    ["POST /api/v1/webhooks/", "write"],
    ["GET /api/v1/webhooks/", "read"],
    ["HEAD /api/v1/webhooks", "read"],
    ["HEAD /api/v1/webhooks/", "read"],
    ["GET /api/v1/webhooks/:id", "read"],
    ["HEAD /api/v1/webhooks/:id", "read"],
    ["PATCH /api/v1/webhooks/:id", "write"],
    ["DELETE /api/v1/webhooks/:id", "write"],
    ["GET /api/v1/webhooks/:id/deliveries", "read"],
    ["HEAD /api/v1/webhooks/:id/deliveries", "read"],
    ["POST /api/v1/webhooks/:id/test", "write"],
    ["GET /api/v1/webhooks/deliveries/stats", "read"],
    ["HEAD /api/v1/webhooks/deliveries/stats", "read"],
    ["GET /api/v1/webhooks/deliveries/failed", "read"],
    ["HEAD /api/v1/webhooks/deliveries/failed", "read"],
    ["POST /api/v1/webhooks/deliveries/retry-all", "write"],
    ["POST /api/v1/webhooks/deliveries/:deliveryId/retry", "write"],
    ["GET /api/v1/audit-logs/", "admin"],
    ["HEAD /api/v1/audit-logs", "admin"],
    ["HEAD /api/v1/audit-logs/", "admin"],
    ["GET /api/v1/audit-logs/:id", "admin"],
    ["HEAD /api/v1/audit-logs/:id", "admin"],
    ["POST /api/v1/tenants/:tenantId/consent/", "write"],
    ["GET /api/v1/tenants/:tenantId/consent/", "read"],
    ["HEAD /api/v1/tenants/:tenantId/consent", "read"],
    ["HEAD /api/v1/tenants/:tenantId/consent/", "read"],
    ["DELETE /api/v1/tenants/:tenantId/consent/:purpose", "write"],
    ["POST /api/v1/regions/", "operator"],
    ["GET /api/v1/regions/", "admin"],
    ["HEAD /api/v1/regions", "admin"],
    ["HEAD /api/v1/regions/", "admin"],
    ["GET /api/v1/regions/:id", "admin"],
    ["HEAD /api/v1/regions/:id", "admin"],
    ["PATCH /api/v1/regions/:id", "operator"],
    ["DELETE /api/v1/regions/:id", "operator"],
    ["POST /api/v1/roles/", "admin"],
    ["GET /api/v1/roles/", "read"],
    ["HEAD /api/v1/roles", "read"],
    ["HEAD /api/v1/roles/", "read"],
    ["GET /api/v1/roles/:id", "read"],
    ["HEAD /api/v1/roles/:id", "read"],
    ["PATCH /api/v1/roles/:id", "admin"],
    ["DELETE /api/v1/roles/:id", "admin"],
    ["POST /api/v1/roles/assign/:keyId", "admin"],
    ["DELETE /api/v1/roles/assign/:keyId", "admin"],
    ["POST /api/v1/maintenance/purge-expired", "operator"],
    ["POST /api/v1/maintenance/rotate-encryption-key", "operator"],
    ["GET /api/v1/config/diff", "read"],
    ["HEAD /api/v1/config/diff", "read"],
    ["POST /api/v1/tenants/:tenantId/abac-policies/", "write"],
    ["GET /api/v1/tenants/:tenantId/abac-policies/", "read"],
    ["HEAD /api/v1/tenants/:tenantId/abac-policies", "read"],
    ["HEAD /api/v1/tenants/:tenantId/abac-policies/", "read"],
    ["POST /api/v1/tenants/:tenantId/abac-policies/evaluate", "write"],
    ["DELETE /api/v1/tenants/:tenantId/abac-policies/:policyId", "write"],
]);

describe("per-route required scope declarations", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import("../app.js");
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("every registered authenticated route declares its required scope", () => {
    const keys = routeKeys();
    expect(keys.length).toBeGreaterThan(0);
    const undeclared = keys
      .filter(([, scope]) => !["read", "write", "admin", "operator"].includes(scope as string))
      .map(([key]) => key);
    expect(undeclared).toEqual([]);
  });

  it("every route keeps the scope it required before per-route declarations", () => {
    const actual = Object.fromEntries(routeKeys());
    expect(actual).toEqual(EXPECTED_SCOPES);
  });
});
