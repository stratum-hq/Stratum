import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StratumClient } from "../client.js";
import type { ResolvedTenantContext, TenantNode } from "@stratum-hq/core";
import {
  ForbiddenError,
  RegionInUseError,
  RegionNotActiveError,
  RegionNotFoundError,
  TenantArchivedError,
  TenantNotFoundError,
  TenantSuspendedError,
  ValidationError,
  WebhookNotFoundError,
} from "@stratum-hq/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONTROL_PLANE_URL = "https://api.stratum.test";
const API_KEY = "sk-test-key-123";

function makeClient(options?: {
  cache?: { enabled?: boolean; ttlMs?: number; maxSize?: number };
  timeoutMs?: number;
}) {
  return new StratumClient({
    controlPlaneUrl: CONTROL_PLANE_URL,
    apiKey: API_KEY,
    ...options,
  });
}

function makeResolvedTenantContext(tenantId: string): ResolvedTenantContext {
  return {
    tenant_id: tenantId,
    ancestry_path: `/${tenantId}`,
    depth: 1,
    resolved_config: {},
    resolved_permissions: {},
    isolation_strategy: "SHARED_RLS",
  };
}

function makeTenantNode(tenantId: string): TenantNode {
  return {
    id: tenantId,
    slug: tenantId,
    name: `Tenant ${tenantId}`,
    parent_id: null,
    ancestry_path: `/${tenantId}`,
    depth: 0,
    isolation_strategy: "SHARED_RLS",
    status: "active",
    metadata: {},
    config: {},
    deleted_at: null,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  } as TenantNode;
}

function mockFetchResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
    headers: new Headers(),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("StratumClient", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // -----------------------------------------------------------------------
  // Authentication header
  // -----------------------------------------------------------------------

  describe("authentication", () => {
    it("sends X-API-Key header with every request", async () => {
      const client = makeClient();
      const ctx = makeResolvedTenantContext("t-1");

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockFetchResponse(ctx),
      );

      await client.resolveTenant("t-1");

      const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(init.headers["X-API-Key"]).toBe(API_KEY);
    });

    it("sends Content-Type application/json with a request body", async () => {
      const client = makeClient();

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockFetchResponse(makeTenantNode("t-1")),
      );

      await client.createTenant({ name: "T", slug: "t_1" } as Parameters<typeof client.createTenant>[0]);

      const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(init.headers["Content-Type"]).toBe("application/json");
    });

    it("omits Content-Type from a GET without a body", async () => {
      const client = makeClient();

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockFetchResponse(makeResolvedTenantContext("t-1")),
      );

      await client.resolveTenant("t-1");

      const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(init.headers).not.toHaveProperty("Content-Type");
    });

    it("omits Content-Type from a DELETE without a body", async () => {
      const client = makeClient();

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockFetchResponse(undefined, 204),
      );

      await client.archiveTenant("t-1");

      const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(init.body).toBeUndefined();
      expect(init.headers).not.toHaveProperty("Content-Type");
    });
  });

  // -----------------------------------------------------------------------
  // resolveTenant
  // -----------------------------------------------------------------------

  describe("resolveTenant", () => {
    it("calls the correct API endpoint", async () => {
      const client = makeClient();
      const ctx = makeResolvedTenantContext("tenant-123");

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockFetchResponse(ctx),
      );

      await client.resolveTenant("tenant-123");

      const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(url).toBe(
        `${CONTROL_PLANE_URL}/api/v1/tenants/tenant-123/context`,
      );
    });

    it("returns the tenant context from the API", async () => {
      const client = makeClient();
      const ctx = makeResolvedTenantContext("tenant-123");

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockFetchResponse(ctx),
      );

      const result = await client.resolveTenant("tenant-123");
      expect(result).toEqual(ctx);
    });

    it("throws UnauthorizedError on 401", async () => {
      const client = makeClient();

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockFetchResponse({}, 401),
      );

      await expect(client.resolveTenant("t-1")).rejects.toThrow(
        "Invalid or missing API key",
      );
    });

    it("throws TenantNotFoundError on a 404 with code TENANT_NOT_FOUND", async () => {
      const client = makeClient();

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockFetchResponse(
          { error: { code: "TENANT_NOT_FOUND", message: "Tenant not found: t-missing" } },
          404,
        ),
      );

      await expect(client.resolveTenant("t-missing")).rejects.toBeInstanceOf(TenantNotFoundError);
    });

    it("throws generic error on other HTTP failures", async () => {
      const client = makeClient();

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockFetchResponse(
          { error: { message: "Internal server error" } },
          500,
        ),
      );

      await expect(client.resolveTenant("t-1")).rejects.toThrow(
        "Internal server error",
      );
    });

    it("keeps the control plane's 404 message without a second prefix", async () => {
      const client = makeClient();

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockFetchResponse(
          { error: { code: "TENANT_NOT_FOUND", message: "Tenant not found: t-missing" } },
          404,
        ),
      );

      const err = await client.resolveTenant("t-missing").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TenantNotFoundError);
      expect((err as Error).message).toBe("Tenant not found: t-missing");
    });

    it("throws TenantSuspendedError on a 403 with code TENANT_SUSPENDED", async () => {
      const client = makeClient();

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockFetchResponse(
          {
            error: {
              code: "TENANT_SUSPENDED",
              message: "Tenant t-1 is suspended",
              details: { tenant_id: "t-1" },
            },
          },
          403,
        ),
      );

      const err = await client.resolveTenant("t-1").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TenantSuspendedError);
      expect((err as Error).message).toBe("Tenant t-1 is suspended");
    });

    it("throws ForbiddenError on a 403 with any other code", async () => {
      const client = makeClient();

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockFetchResponse(
          { error: { code: "FORBIDDEN", message: "Insufficient permissions for this operation" } },
          403,
        ),
      );

      const err = await client.resolveTenant("t-1").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ForbiddenError);
      expect((err as Error).message).toBe("Insufficient permissions for this operation");
    });

    it("throws TenantArchivedError on a 410 with code TENANT_ARCHIVED", async () => {
      const client = makeClient();

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockFetchResponse(
          { error: { code: "TENANT_ARCHIVED", message: "Tenant t-1 is archived" } },
          410,
        ),
      );

      const err = await client.resolveTenant("t-1").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TenantArchivedError);
      expect((err as Error).message).toBe("Tenant t-1 is archived");
    });
  });

  // -----------------------------------------------------------------------
  // 404 mapping by error code
  // -----------------------------------------------------------------------

  // A 404 can come from any route, so only the error code identifies what is missing.
  describe("404 mapping by error code", () => {
    it("throws WebhookNotFoundError on a 404 with code WEBHOOK_NOT_FOUND", async () => {
      const client = makeClient();
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockFetchResponse({ error: { code: "WEBHOOK_NOT_FOUND", message: "Webhook not found: w-1" } }, 404),
      );

      const err = await client.getWebhook("w-1").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(WebhookNotFoundError);
      expect((err as Error).message).toBe("Webhook not found: w-1");
    });

    it("keeps the message of a 404 with another code and does not throw TenantNotFoundError", async () => {
      const client = makeClient();
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockFetchResponse({ error: { code: "NOT_FOUND", message: "API key not found or already revoked" } }, 404),
      );

      const err = await client.rotateApiKey("k-1").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(TenantNotFoundError);
      expect((err as Error).message).toBe("API key not found or already revoked");
    });

    it("does not throw TenantNotFoundError on a 404 without an error code", async () => {
      const client = makeClient();
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockFetchResponse({ message: "Route GET:/api/v1/regions/x not found" }, 404),
      );

      const err = await client.deleteRegion("x").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(TenantNotFoundError);
      expect((err as Error).message).toBe("HTTP 404");
    });

    it("throws RegionNotFoundError on a 404 with code REGION_NOT_FOUND", async () => {
      const client = makeClient();
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockFetchResponse({ error: { code: "REGION_NOT_FOUND", message: "Region not found: r-1" } }, 404),
      );

      const err = await client.deleteRegion("r-1").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RegionNotFoundError);
      expect((err as Error).message).toBe("Region not found: r-1");
    });
  });

  // -----------------------------------------------------------------------
  // 400 and 409 mapping by error code
  // -----------------------------------------------------------------------

  describe("validation error mapping", () => {
    const issues = [{ path: ["slug"], message: "Required", code: "invalid_type" }];

    it("throws ValidationError with the issues from error.details.issues", async () => {
      const client = makeClient();
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockFetchResponse(
          { error: { code: "VALIDATION_ERROR", message: "Validation failed", details: { issues }, issues } },
          400,
        ),
      );

      const err = await client.createTenant({ name: "x" } as never).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).message).toBe("Validation failed");
      expect((err as ValidationError).details).toEqual({ issues });
    });

    it("reads the issues from error.issues when a control plane sends only that field", async () => {
      const client = makeClient();
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockFetchResponse({ error: { code: "VALIDATION_ERROR", message: "Validation failed", issues } }, 400),
      );

      const err = await client.createTenant({ name: "x" } as never).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).details).toEqual({ issues });
    });

    it("throws ValidationError without details when the response has no issues", async () => {
      const client = makeClient();
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockFetchResponse({ error: { code: "VALIDATION_ERROR", message: "Batch limited to 100 tenants" } }, 400),
      );

      const err = await client.createTenant({ name: "x" } as never).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).message).toBe("Batch limited to 100 tenants");
      expect((err as ValidationError).details).toBeUndefined();
    });

    it("keeps error.details when the response has details but no issues", async () => {
      const client = makeClient();
      const details = { field: "tenant_ids", limit: 100 };
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockFetchResponse(
          { error: { code: "VALIDATION_ERROR", message: "Batch limited to 100 tenants", details } },
          400,
        ),
      );

      const err = await client.createTenant({ name: "x" } as never).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).details).toEqual(details);
    });

    it("adds the legacy error.issues to error.details when details has no issues", async () => {
      const client = makeClient();
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockFetchResponse(
          { error: { code: "VALIDATION_ERROR", message: "Validation failed", details: { field: "slug" }, issues } },
          400,
        ),
      );

      const err = await client.createTenant({ name: "x" } as never).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).details).toEqual({ field: "slug", issues });
    });

    it("throws a plain Error on a 400 with another code", async () => {
      const client = makeClient();
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockFetchResponse({ error: { code: "ISOLATION_STRATEGY_UNSUPPORTED", message: "Not supported" } }, 400),
      );

      const err = await client.createTenant({ name: "x" } as never).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(ValidationError);
      expect((err as Error).message).toBe("Not supported");
    });
  });

  describe("region conflict mapping", () => {
    it("throws RegionInUseError on a 409 with code REGION_IN_USE", async () => {
      const client = makeClient();
      const message = "Cannot delete region r-1: active tenants are still assigned to it";
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockFetchResponse({ error: { code: "REGION_IN_USE", message, details: { region_id: "r-1" } } }, 409),
      );

      const err = await client.deleteRegion("r-1").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RegionInUseError);
      expect((err as RegionInUseError).message).toBe(message);
      expect((err as RegionInUseError).details).toEqual({ region_id: "r-1" });
    });

    // The control plane sends REGION_NOT_ACTIVE from POST /api/v1/tenants/{id}/migrate-region.
    // The SDK has no method for that route yet. The mapping reads only the status and
    // the code, so this test sends the response through updateRegion. A future
    // migrateRegion method gets the same mapping without a change.
    it("throws RegionNotActiveError on a 409 with code REGION_NOT_ACTIVE from any route", async () => {
      const client = makeClient();
      const message = "Cannot migrate to region r-1: region is not active";
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockFetchResponse({ error: { code: "REGION_NOT_ACTIVE", message, details: { region_id: "r-1" } } }, 409),
      );

      const err = await client.updateRegion("r-1", {}).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RegionNotActiveError);
      expect((err as RegionNotActiveError).message).toBe(message);
      expect((err as RegionNotActiveError).details).toEqual({ region_id: "r-1" });
    });
  });

  // -----------------------------------------------------------------------
  // Request timeout
  // -----------------------------------------------------------------------

  describe("request timeout", () => {
    /** A fetch that never answers and rejects only when its signal aborts. */
    function stalledFetch() {
      return vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
          }),
      );
    }

    it("sends an abort signal with every request by default", async () => {
      const client = makeClient();

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockFetchResponse(makeResolvedTenantContext("t-1")),
      );

      await client.resolveTenant("t-1");

      const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
    });

    it("rejects a stalled request with a TimeoutError after timeoutMs", async () => {
      const client = new StratumClient({
        controlPlaneUrl: CONTROL_PLANE_URL,
        apiKey: API_KEY,
        timeoutMs: 20,
      });
      globalThis.fetch = stalledFetch() as unknown as typeof fetch;

      const err = await client.resolveTenant("t-1").catch((e: unknown) => e);
      expect((err as Error).name).toBe("TimeoutError");
    });

    for (const value of [0, -1, Number.NaN, 1.5, 2 ** 32]) {
      it(`rejects timeoutMs ${value} with a RangeError from the constructor`, () => {
        expect(() => makeClient({ timeoutMs: value })).toThrow(RangeError);
      });
    }

    it("sends no abort signal when timeoutMs is Infinity", async () => {
      const client = makeClient({ timeoutMs: Number.POSITIVE_INFINITY });
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockFetchResponse(makeResolvedTenantContext("t-1")),
      );

      await client.resolveTenant("t-1");

      const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect((init as RequestInit).signal).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // getTenantTree
  // -----------------------------------------------------------------------

  describe("getTenantTree", () => {
    it("calls /api/v1/tenants when no rootId is provided", async () => {
      const client = makeClient();
      const nodes = [makeTenantNode("t-1")];

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockFetchResponse({ data: nodes }),
      );

      const result = await client.getTenantTree();

      const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(url).toBe(`${CONTROL_PLANE_URL}/api/v1/tenants`);
      expect(result).toEqual(nodes);
    });

    it("calls /api/v1/tenants/{rootId}/descendants when rootId is provided", async () => {
      const client = makeClient();
      const nodes = [makeTenantNode("child-1")];

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockFetchResponse(nodes),
      );

      const result = await client.getTenantTree("root-id");

      const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(url).toBe(
        `${CONTROL_PLANE_URL}/api/v1/tenants/root-id/descendants`,
      );
      expect(result).toEqual(nodes);
    });
  });

  // -----------------------------------------------------------------------
  // Cache behavior
  // -----------------------------------------------------------------------

  describe("caching", () => {
    it("cache hit returns cached result without API call", async () => {
      const client = makeClient({ cache: { enabled: true } });
      const ctx = makeResolvedTenantContext("cached-tenant");

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockFetchResponse(ctx),
      );

      // First call — populates cache
      const first = await client.resolveTenant("cached-tenant");
      expect(first).toEqual(ctx);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);

      // Second call — should be served from cache
      const second = await client.resolveTenant("cached-tenant");
      expect(second).toEqual(ctx);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1); // No additional fetch
    });

    it("cache miss fetches from API", async () => {
      const client = makeClient({ cache: { enabled: true } });
      const ctx1 = makeResolvedTenantContext("tenant-a");
      const ctx2 = makeResolvedTenantContext("tenant-b");

      (globalThis.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(mockFetchResponse(ctx1))
        .mockResolvedValueOnce(mockFetchResponse(ctx2));

      await client.resolveTenant("tenant-a");
      await client.resolveTenant("tenant-b");

      // Two different tenants = two API calls
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it("cache is enabled by default", async () => {
      const client = makeClient(); // No explicit cache config
      const ctx = makeResolvedTenantContext("t-default");

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockFetchResponse(ctx),
      );

      await client.resolveTenant("t-default");
      await client.resolveTenant("t-default");

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it("cache can be disabled", async () => {
      const client = makeClient({ cache: { enabled: false } });
      const ctx = makeResolvedTenantContext("t-nocache");

      (globalThis.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(mockFetchResponse(ctx))
        .mockResolvedValueOnce(mockFetchResponse(ctx));

      await client.resolveTenant("t-nocache");
      await client.resolveTenant("t-nocache");

      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });
  });

  // -----------------------------------------------------------------------
  // Mutations invalidate cache
  // -----------------------------------------------------------------------

  describe("cache invalidation on mutations", () => {
    it("updateTenant invalidates the cache for that tenant", async () => {
      const client = makeClient({ cache: { enabled: true } });
      const ctx = makeResolvedTenantContext("t-update");
      const updatedNode = makeTenantNode("t-update");

      (globalThis.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(mockFetchResponse(ctx)) // resolveTenant
        .mockResolvedValueOnce(mockFetchResponse(updatedNode)) // updateTenant
        .mockResolvedValueOnce(mockFetchResponse(ctx)); // resolveTenant again

      // Populate cache
      await client.resolveTenant("t-update");
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);

      // Mutate — should invalidate cache
      await client.updateTenant("t-update", { name: "Updated" });

      // Resolve again — should make a new API call
      await client.resolveTenant("t-update");
      expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    });

    it("moveTenant invalidates the cache for that tenant", async () => {
      const client = makeClient({ cache: { enabled: true } });
      const ctx = makeResolvedTenantContext("t-move");
      const movedNode = makeTenantNode("t-move");

      (globalThis.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(mockFetchResponse(ctx))
        .mockResolvedValueOnce(mockFetchResponse(movedNode))
        .mockResolvedValueOnce(mockFetchResponse(ctx));

      await client.resolveTenant("t-move");
      await client.moveTenant("t-move", { new_parent_id: "parent-2" });
      await client.resolveTenant("t-move");

      expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    });

    it("archiveTenant invalidates the cache for that tenant", async () => {
      const client = makeClient({ cache: { enabled: true } });
      const ctx = makeResolvedTenantContext("t-archive");

      (globalThis.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(mockFetchResponse(ctx))
        .mockResolvedValueOnce(mockFetchResponse(undefined, 204))
        .mockResolvedValueOnce(mockFetchResponse(ctx));

      await client.resolveTenant("t-archive");
      await client.archiveTenant("t-archive");
      await client.resolveTenant("t-archive");

      expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    });

    it("deleteTenant invalidates the cache for that tenant", async () => {
      const client = makeClient({ cache: { enabled: true } });
      const ctx = makeResolvedTenantContext("t-delete");

      (globalThis.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(mockFetchResponse(ctx))
        .mockResolvedValueOnce(mockFetchResponse(undefined, 204))
        .mockResolvedValueOnce(mockFetchResponse(ctx));

      await client.resolveTenant("t-delete");
      await client.deleteTenant("t-delete");
      await client.resolveTenant("t-delete");

      expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    });

    it("purgeTenant invalidates the cache for that tenant", async () => {
      const client = makeClient({ cache: { enabled: true } });
      const ctx = makeResolvedTenantContext("t-purge");

      (globalThis.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(mockFetchResponse(ctx))
        .mockResolvedValueOnce(mockFetchResponse(undefined, 204))
        .mockResolvedValueOnce(mockFetchResponse(ctx));

      await client.resolveTenant("t-purge");
      await client.purgeTenant("t-purge");
      await client.resolveTenant("t-purge");

      expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    });

    it("invalidateCache manually removes a cached entry", async () => {
      const client = makeClient({ cache: { enabled: true } });
      const ctx = makeResolvedTenantContext("t-manual");

      (globalThis.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(mockFetchResponse(ctx))
        .mockResolvedValueOnce(mockFetchResponse(ctx));

      await client.resolveTenant("t-manual");
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);

      client.invalidateCache("t-manual");

      await client.resolveTenant("t-manual");
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it("clearCache removes all cached entries", async () => {
      const client = makeClient({ cache: { enabled: true } });
      const ctxA = makeResolvedTenantContext("t-a");
      const ctxB = makeResolvedTenantContext("t-b");

      (globalThis.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(mockFetchResponse(ctxA))
        .mockResolvedValueOnce(mockFetchResponse(ctxB))
        .mockResolvedValueOnce(mockFetchResponse(ctxA))
        .mockResolvedValueOnce(mockFetchResponse(ctxB));

      await client.resolveTenant("t-a");
      await client.resolveTenant("t-b");
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);

      client.clearCache();

      await client.resolveTenant("t-a");
      await client.resolveTenant("t-b");
      expect(globalThis.fetch).toHaveBeenCalledTimes(4);
    });
  });

  // -----------------------------------------------------------------------
  // URL normalization
  // -----------------------------------------------------------------------

  // The request shape is the contract with the control plane. The error
  // mapping has its own tests in the resolveTenant and 404 mapping blocks.
  describe("tenant removal requests", () => {
    // A timeout does not prove that the purge failed, so the cached context must go either way.
    it("purgeTenant removes the cached context when the request fails", async () => {
      const client = makeClient({ cache: { enabled: true } });
      const ctx = makeResolvedTenantContext("t-purge");
      (globalThis.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(mockFetchResponse(ctx))
        .mockRejectedValueOnce(new DOMException("The operation timed out.", "TimeoutError"))
        .mockResolvedValueOnce(mockFetchResponse(ctx));

      await client.resolveTenant("t-purge");
      await expect(client.purgeTenant("t-purge")).rejects.toThrow("The operation timed out.");
      await client.resolveTenant("t-purge");

      expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    });

    it("purgeTenant sends POST to the purge route with the encoded id", async () => {
      const client = makeClient({ cache: { enabled: false } });
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockFetchResponse(undefined, 204),
      );

      await expect(client.purgeTenant("a/b c")).resolves.toBeUndefined();

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0] as [string, RequestInit];
      expect(url).toBe(`${CONTROL_PLANE_URL}/api/v1/tenants/a%2Fb%20c/purge`);
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>)["X-API-Key"]).toBe(API_KEY);
    });

    // Fastify rejects a request that has the JSON content type and no body
    // (FST_ERR_CTP_EMPTY_JSON_BODY), so a body-less request omits that header.
    it("purgeTenant sends no body and no JSON content type", async () => {
      const client = makeClient({ cache: { enabled: false } });
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockFetchResponse(undefined, 204),
      );

      await client.purgeTenant("t-1");

      const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0] as [string, RequestInit];
      expect(init.body).toBeUndefined();
      expect(init.headers as Record<string, string>).not.toHaveProperty("Content-Type");
    });

    it("purgeTenant rejects an id that is a dot segment before it sends a request", async () => {
      const client = makeClient({ cache: { enabled: false } });

      await expect(client.purgeTenant("..")).rejects.toThrow("Invalid identifier");

      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("deleteTenant sends the same archive request as archiveTenant", async () => {
      const client = makeClient({ cache: { enabled: false } });
      (globalThis.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(mockFetchResponse(undefined, 204))
        .mockResolvedValueOnce(mockFetchResponse(undefined, 204));

      await client.archiveTenant("t-1");
      await client.deleteTenant("t-1");

      const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls as Array<[string, RequestInit]>;
      expect(calls[0][0]).toBe(`${CONTROL_PLANE_URL}/api/v1/tenants/t-1`);
      expect(calls[0][1].method).toBe("DELETE");
      expect(calls[1][0]).toBe(calls[0][0]);
      expect(calls[1][1].method).toBe(calls[0][1].method);
    });
  });

  describe("URL handling", () => {
    it("strips trailing slash from controlPlaneUrl", async () => {
      const client = new StratumClient({
        controlPlaneUrl: "https://api.stratum.test/",
        apiKey: API_KEY,
      });
      const ctx = makeResolvedTenantContext("t-1");

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockFetchResponse(ctx),
      );

      await client.resolveTenant("t-1");

      const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(url).toBe(
        "https://api.stratum.test/api/v1/tenants/t-1/context",
      );
      // No double slash
      expect(url).not.toContain("//api/");
    });
  });
});
