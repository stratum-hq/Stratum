import { describe, it, expect, vi, beforeEach } from "vitest";
import { expressMiddleware } from "../middleware/express.js";
import type { TenantContextLegacy } from "@stratum-hq/core";
import { TenantNotFoundError } from "@stratum-hq/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTenantContextLegacy(tenantId: string): TenantContextLegacy {
  return {
    tenant_id: tenantId,
    ancestry_path: `/${tenantId}`,
    depth: 1,
    resolved_config: {},
    resolved_permissions: {},
    isolation_strategy: "SHARED_RLS",
  };
}

function makeReq(headers: Record<string, string> = {}) {
  return {
    headers: {
      ...headers,
    },
    tenant: undefined as TenantContextLegacy | undefined,
  };
}

function makeRes() {
  const res: Record<string, unknown> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

function makeClient(overrides: Partial<{ resolveTenant: ReturnType<typeof vi.fn> }> = {}) {
  return {
    resolveTenant:
      overrides.resolveTenant ?? vi.fn().mockResolvedValue(makeTenantContextLegacy("default-tenant")),
  } as unknown as import("../client.js").StratumClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("expressMiddleware", () => {
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    next = vi.fn();
  });

  describe("tenant resolution from header", () => {
    it("sets req.tenant from X-Tenant-ID header", async () => {
      const ctx = makeTenantContextLegacy("tenant-from-header");
      const client = makeClient({
        resolveTenant: vi.fn().mockResolvedValue(ctx),
      });
      const middleware = expressMiddleware(client);
      const req = makeReq({ "x-tenant-id": "tenant-from-header" });
      const res = makeRes();

      await middleware(req, res, next);

      expect(req.tenant).toEqual(ctx);
      expect(client.resolveTenant).toHaveBeenCalledWith("tenant-from-header");
    });

    it("calls next() on successful resolution", async () => {
      const ctx = makeTenantContextLegacy("t-1");
      const client = makeClient({
        resolveTenant: vi.fn().mockResolvedValue(ctx),
      });
      const middleware = expressMiddleware(client);
      const req = makeReq({ "x-tenant-id": "t-1" });
      const res = makeRes();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      // next() called without error argument
      expect(next).toHaveBeenCalledWith();
    });
  });

  describe("missing tenant", () => {
    it("returns 400 when no tenant ID can be resolved", async () => {
      const client = makeClient();
      const middleware = expressMiddleware(client);
      const req = makeReq(); // No tenant header
      const res = makeRes();

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: "MISSING_TENANT",
          }),
        }),
      );
    });

    it("does not call next() when tenant is missing", async () => {
      const client = makeClient();
      const middleware = expressMiddleware(client);
      const req = makeReq();
      const res = makeRes();

      await middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("tenant not found", () => {
    it("returns 404 when resolveTenant throws TenantNotFoundError", async () => {
      const client = makeClient({
        resolveTenant: vi.fn().mockRejectedValue(new TenantNotFoundError("t-missing")),
      });
      const middleware = expressMiddleware(client);
      const req = makeReq({ "x-tenant-id": "t-missing" });
      const res = makeRes();

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            code: "TENANT_NOT_FOUND",
          }),
        }),
      );
    });

    it("does not call next() when tenant is not found", async () => {
      const client = makeClient({
        resolveTenant: vi.fn().mockRejectedValue(new TenantNotFoundError("t-missing")),
      });
      const middleware = expressMiddleware(client);
      const req = makeReq({ "x-tenant-id": "t-missing" });
      const res = makeRes();

      await middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("calls next(err) when an unexpected error occurs", async () => {
      const error = new Error("unexpected failure");
      const client = makeClient({
        resolveTenant: vi.fn().mockRejectedValue(error),
      });
      const middleware = expressMiddleware(client);
      const req = makeReq({ "x-tenant-id": "t-1" });
      const res = makeRes();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });

    it("calls onError callback when provided and error is thrown", async () => {
      const error = new Error("unexpected");
      const onError = vi.fn();
      const client = makeClient({
        resolveTenant: vi.fn().mockRejectedValue(error),
      });
      const middleware = expressMiddleware(client, { onError });
      const req = makeReq({ "x-tenant-id": "t-1" });
      const res = makeRes();

      await middleware(req, res, next);

      expect(onError).toHaveBeenCalledWith(error, req);
    });
  });

  describe("custom resolvers", () => {
    it("uses custom resolver when header resolution fails", async () => {
      const ctx = makeTenantContextLegacy("custom-resolved");
      const client = makeClient({
        resolveTenant: vi.fn().mockResolvedValue(ctx),
      });
      const customResolver = {
        resolve: vi.fn().mockResolvedValue("custom-resolved"),
      };
      const middleware = expressMiddleware(client, {
        resolvers: [customResolver],
      });
      const req = makeReq(); // No header
      const res = makeRes();

      await middleware(req, res, next);

      expect(customResolver.resolve).toHaveBeenCalledWith(req);
      expect(req.tenant).toEqual(ctx);
      expect(next).toHaveBeenCalled();
    });

    it("stops at the first resolver that returns a value", async () => {
      const ctx = makeTenantContextLegacy("first-resolved");
      const client = makeClient({
        resolveTenant: vi.fn().mockResolvedValue(ctx),
      });
      const resolver1 = {
        resolve: vi.fn().mockResolvedValue("first-resolved"),
      };
      const resolver2 = {
        resolve: vi.fn().mockResolvedValue("second-resolved"),
      };
      const middleware = expressMiddleware(client, {
        resolvers: [resolver1, resolver2],
      });
      const req = makeReq();
      const res = makeRes();

      await middleware(req, res, next);

      expect(resolver1.resolve).toHaveBeenCalled();
      expect(resolver2.resolve).not.toHaveBeenCalled();
    });
  });
});
