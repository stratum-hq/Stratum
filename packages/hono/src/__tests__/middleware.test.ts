import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { Context } from "hono";
import { stratumMiddleware } from "../middleware.js";
import {
  ForbiddenError,
  TenantArchivedError,
  TenantNotFoundError,
  TenantSuspendedError,
  UnauthorizedError,
} from "@stratum-hq/core";

// Mock runWithTenantContext from SDK — execute the callback so downstream handlers run.
// The tenant error mapping stays real, so the tests check the shared mapping.
vi.mock("@stratum-hq/sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@stratum-hq/sdk")>()),
  runWithTenantContext: vi.fn((_ctx: unknown, fn: () => unknown) => fn()),
}));

import { runWithTenantContext } from "@stratum-hq/sdk";

const mockedRunWithTenantContext = vi.mocked(runWithTenantContext);

function createApp(options?: Parameters<typeof stratumMiddleware>[0]) {
  const app = new Hono();
  app.use("/*", stratumMiddleware({ trustTenantHeader: true, ...options }));
  app.get("/test", (c) => c.json({ tenantId: c.get("tenantId") }));
  app.get("/tenants/:tenantId/resources", (c) =>
    c.json({ tenantId: c.get("tenantId") }),
  );
  return app;
}

describe("stratumMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts tenant ID from default x-tenant-id header", async () => {
    const app = createApp();
    const res = await app.request("/test", {
      headers: { "x-tenant-id": "tenant-abc" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tenantId).toBe("tenant-abc");
  });

  it("extracts tenant ID from a custom header", async () => {
    const app = createApp({ header: "x-org-id" });
    const res = await app.request("/test", {
      headers: { "x-org-id": "org-123" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tenantId).toBe("org-123");
  });

  it("extracts tenant ID from JWT claim", async () => {
    const app = new Hono();
    // Simulate JWT middleware setting the payload
    app.use("/*", async (c, next) => {
      c.set("jwtPayload", { org_id: "jwt-tenant-1", sub: "user-1" });
      await next();
    });
    app.use("/*", stratumMiddleware({ jwtClaim: "org_id" }));
    app.get("/test", (c) => c.json({ tenantId: c.get("tenantId") }));

    const res = await app.request("/test");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tenantId).toBe("jwt-tenant-1");
  });

  it("extracts tenant ID from URL path parameter", async () => {
    const app = new Hono();
    app.use("/tenants/:tenantId/*", stratumMiddleware({ pathParam: "tenantId", trustPathParam: true }));
    app.get("/tenants/:tenantId/resources", (c) =>
      c.json({ tenantId: c.get("tenantId") }),
    );

    const res = await app.request("/tenants/path-tenant-99/resources");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tenantId).toBe("path-tenant-99");
  });

  it("returns 400 when tenant ID is missing", async () => {
    const app = createApp();
    const res = await app.request("/test");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Missing tenant ID");
  });

  it("sets tenant ID in Hono context", async () => {
    const app = new Hono();
    let contextTenantId: string | undefined;
    app.use("/*", stratumMiddleware({ trustTenantHeader: true }));
    app.get("/test", (c) => {
      contextTenantId = c.get("tenantId");
      return c.json({ ok: true });
    });

    await app.request("/test", {
      headers: { "x-tenant-id": "ctx-tenant" },
    });
    expect(contextTenantId).toBe("ctx-tenant");
  });

  it("sets ALS context via SDK runWithTenantContext", async () => {
    const app = createApp();
    await app.request("/test", {
      headers: { "x-tenant-id": "als-tenant" },
    });

    expect(mockedRunWithTenantContext).toHaveBeenCalledOnce();
    expect(mockedRunWithTenantContext).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: "als-tenant" }),
      expect.any(Function),
    );
  });

  it("calls next() and allows downstream handlers to run", async () => {
    const app = new Hono();
    const handler = vi.fn((c: Context) => c.json({ ok: true }));
    app.use("/*", stratumMiddleware({ trustTenantHeader: true }));
    app.get("/test", handler);

    const res = await app.request("/test", {
      headers: { "x-tenant-id": "next-tenant" },
    });
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("returns 400 when JWT payload is missing", async () => {
    const app = new Hono();
    app.use("/*", stratumMiddleware({ jwtClaim: "org_id" }));
    app.get("/test", (c) => c.json({ ok: true }));

    const res = await app.request("/test");
    expect(res.status).toBe(400);
  });

  describe("unverified tenant header", () => {
    it("refuses to read the tenant header unless trustTenantHeader is true", () => {
      expect(() => stratumMiddleware()).toThrow(/trustTenantHeader/);
      expect(() => stratumMiddleware({ header: "x-org-id" })).toThrow(/trustTenantHeader/);
    });

    it("refuses to read the tenant header even with a resolve callback unless trustTenantHeader is true", () => {
      expect(() =>
        stratumMiddleware({ resolve: async (id) => ({ tenant_id: id }) as never }),
      ).toThrow(/trustTenantHeader/);
    });

    it("reads the tenant header when trustTenantHeader is true", async () => {
      const app = new Hono();
      app.use("/*", stratumMiddleware({ trustTenantHeader: true }));
      app.get("/test", (c) => c.json({ tenantId: c.get("tenantId") }));
      const res = await app.request("/test", { headers: { "x-tenant-id": "trusted" } });
      expect(res.status).toBe(200);
      expect((await res.json()).tenantId).toBe("trusted");
    });

    it("does not require trustTenantHeader for a JWT claim or path parameter source", () => {
      expect(() => stratumMiddleware({ jwtClaim: "org_id" })).not.toThrow();
      expect(() => stratumMiddleware({ pathParam: "tenantId", trustPathParam: true })).not.toThrow();
    });
  });

  describe("unverified tenant path parameter", () => {
    it("refuses to read the tenant from a path parameter unless trustPathParam is true", () => {
      expect(() => stratumMiddleware({ pathParam: "tenantId" })).toThrow(/trustPathParam/);
      expect(() => stratumMiddleware({ pathParam: "tenantId", trustTenantHeader: true })).toThrow(
        /trustPathParam/,
      );
    });

    it("refuses to read the tenant from a path parameter even with a resolve callback unless trustPathParam is true", () => {
      expect(() =>
        stratumMiddleware({ pathParam: "tenantId", resolve: async (id) => ({ tenant_id: id }) as never }),
      ).toThrow(/trustPathParam/);
    });

    it("does not require trustPathParam when a JWT claim is the tenant source", () => {
      expect(() => stratumMiddleware({ jwtClaim: "org_id", pathParam: "tenantId" })).not.toThrow();
    });
  });

  describe("tenant errors from resolve", () => {
    const cases = [
      { error: () => new TenantNotFoundError("t-1"), status: 404, code: "TENANT_NOT_FOUND" },
      { error: () => new TenantSuspendedError("t-1"), status: 403, code: "TENANT_SUSPENDED" },
      { error: () => new TenantArchivedError("t-1"), status: 410, code: "TENANT_ARCHIVED" },
      { error: () => new ForbiddenError(), status: 403, code: "FORBIDDEN" },
    ];

    for (const tc of cases) {
      it(`answers ${tc.status} ${tc.code} when resolve rejects with ${tc.error().name}`, async () => {
        const handler = vi.fn((c: Context) => c.json({ ok: true }));
        const app = new Hono();
        app.use("/*", stratumMiddleware({ trustTenantHeader: true, resolve: () => Promise.reject(tc.error()) }));
        app.get("/test", handler);

        const res = await app.request("/test", { headers: { "x-tenant-id": "t-1" } });

        expect(res.status).toBe(tc.status);
        expect(await res.json()).toEqual({ error: expect.objectContaining({ code: tc.code }) });
        expect(handler).not.toHaveBeenCalled();
      });
    }

    it("answers 504 CONTROL_PLANE_TIMEOUT when resolve times out", async () => {
      const app = new Hono();
      const timeout = new DOMException("The operation timed out.", "TimeoutError");
      app.use("/*", stratumMiddleware({ trustTenantHeader: true, resolve: () => Promise.reject(timeout) }));
      app.get("/test", (c) => c.json({ ok: true }));

      const res = await app.request("/test", { headers: { "x-tenant-id": "t-1" } });

      expect(res.status).toBe(504);
      expect(await res.json()).toEqual({ error: expect.objectContaining({ code: "CONTROL_PLANE_TIMEOUT" }) });
    });

    it("answers 500 CONTROL_PLANE_AUTH_FAILED and logs the cause when the control plane rejects the SDK key", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const app = new Hono();
      app.use("/*", stratumMiddleware({ trustTenantHeader: true, resolve: () => Promise.reject(new UnauthorizedError()) }));
      app.get("/test", (c) => c.json({ ok: true }));

      const res = await app.request("/test", { headers: { "x-tenant-id": "t-1" } });

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: expect.objectContaining({ code: "CONTROL_PLANE_AUTH_FAILED" }) });
      expect(log).toHaveBeenCalledWith(expect.stringContaining("SDK API key"));
      log.mockRestore();
    });

    it("passes any other resolve error to the Hono error handler", async () => {
      const app = new Hono();
      app.use("/*", stratumMiddleware({ trustTenantHeader: true, resolve: () => Promise.reject(new Error("boom")) }));
      app.get("/test", (c) => c.json({ ok: true }));
      app.onError((err, c) => c.json({ caught: err.message }, 500));

      const res = await app.request("/test", { headers: { "x-tenant-id": "t-1" } });

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ caught: "boom" });
    });
  });
});
