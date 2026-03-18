import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StratumClient } from "../client.js";
import type { TenantContextLegacy, TenantNode } from "@stratum-hq/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONTROL_PLANE_URL = "https://api.stratum.test";
const API_KEY = "sk-test-key-123";

function makeClient(options?: {
  cache?: { enabled?: boolean; ttlMs?: number; maxSize?: number };
}) {
  return new StratumClient({
    controlPlaneUrl: CONTROL_PLANE_URL,
    apiKey: API_KEY,
    ...options,
  });
}

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
      const ctx = makeTenantContextLegacy("t-1");

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockFetchResponse(ctx),
      );

      await client.resolveTenant("t-1");

      const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(init.headers["X-API-Key"]).toBe(API_KEY);
    });

    it("sends Content-Type application/json header", async () => {
      const client = makeClient();
      const ctx = makeTenantContextLegacy("t-1");

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockFetchResponse(ctx),
      );

      await client.resolveTenant("t-1");

      const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(init.headers["Content-Type"]).toBe("application/json");
    });
  });

  // -----------------------------------------------------------------------
  // resolveTenant
  // -----------------------------------------------------------------------

  describe("resolveTenant", () => {
    it("calls the correct API endpoint", async () => {
      const client = makeClient();
      const ctx = makeTenantContextLegacy("tenant-123");

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
      const ctx = makeTenantContextLegacy("tenant-123");

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

    it("throws TenantNotFoundError on 404", async () => {
      const client = makeClient();

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockFetchResponse(
          { error: { message: "Tenant not found: t-missing" } },
          404,
        ),
      );

      await expect(client.resolveTenant("t-missing")).rejects.toThrow(
        "Tenant not found: t-missing",
      );
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
      const ctx = makeTenantContextLegacy("cached-tenant");

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
      const ctx1 = makeTenantContextLegacy("tenant-a");
      const ctx2 = makeTenantContextLegacy("tenant-b");

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
      const ctx = makeTenantContextLegacy("t-default");

      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockFetchResponse(ctx),
      );

      await client.resolveTenant("t-default");
      await client.resolveTenant("t-default");

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it("cache can be disabled", async () => {
      const client = makeClient({ cache: { enabled: false } });
      const ctx = makeTenantContextLegacy("t-nocache");

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
      const ctx = makeTenantContextLegacy("t-update");
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
      const ctx = makeTenantContextLegacy("t-move");
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
      const ctx = makeTenantContextLegacy("t-archive");

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
      const ctx = makeTenantContextLegacy("t-delete");

      (globalThis.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(mockFetchResponse(ctx))
        .mockResolvedValueOnce(mockFetchResponse(undefined, 204))
        .mockResolvedValueOnce(mockFetchResponse(ctx));

      await client.resolveTenant("t-delete");
      await client.deleteTenant("t-delete");
      await client.resolveTenant("t-delete");

      expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    });

    it("invalidateCache manually removes a cached entry", async () => {
      const client = makeClient({ cache: { enabled: true } });
      const ctx = makeTenantContextLegacy("t-manual");

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
      const ctxA = makeTenantContextLegacy("t-a");
      const ctxB = makeTenantContextLegacy("t-b");

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

  describe("URL handling", () => {
    it("strips trailing slash from controlPlaneUrl", async () => {
      const client = new StratumClient({
        controlPlaneUrl: "https://api.stratum.test/",
        apiKey: API_KEY,
      });
      const ctx = makeTenantContextLegacy("t-1");

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
