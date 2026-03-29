// @ts-nocheck — Hono typed context requires variable declarations; tests verified via vitest runtime
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { stratumMiddleware } from "../middleware.js";

// Mock setTenantContext from SDK
vi.mock("@stratum-hq/sdk", () => ({
  setTenantContext: vi.fn(),
}));

import { setTenantContext } from "@stratum-hq/sdk";

const mockedSetTenantContext = vi.mocked(setTenantContext);

function createApp(options?: Parameters<typeof stratumMiddleware>[0]) {
  const app = new Hono();
  app.use("/*", stratumMiddleware(options));
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
    app.use("/tenants/:tenantId/*", stratumMiddleware({ pathParam: "tenantId" }));
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
    app.use("/*", stratumMiddleware());
    app.get("/test", (c) => {
      contextTenantId = c.get("tenantId");
      return c.json({ ok: true });
    });

    await app.request("/test", {
      headers: { "x-tenant-id": "ctx-tenant" },
    });
    expect(contextTenantId).toBe("ctx-tenant");
  });

  it("sets ALS context via SDK setTenantContext", async () => {
    const app = createApp();
    await app.request("/test", {
      headers: { "x-tenant-id": "als-tenant" },
    });

    expect(mockedSetTenantContext).toHaveBeenCalledOnce();
    expect(mockedSetTenantContext).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: "als-tenant" }),
    );
  });

  it("calls next() and allows downstream handlers to run", async () => {
    const app = new Hono();
    const handler = vi.fn((c: any) => c.json({ ok: true }));
    app.use("/*", stratumMiddleware());
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
});
