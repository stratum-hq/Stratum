import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StratumClient } from "../client.js";
import type { ResolvedTenantContext, TenantNode } from "@stratum-hq/core";
import {
  ForbiddenError,
  TenantArchivedError,
  TenantNotFoundError,
  TenantSuspendedError,
} from "@stratum-hq/core";

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

    it("sends Content-Type application/json header", async () => {
      const client = makeClient();
      const ctx = makeResolvedTenantContext("t-1");

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

  // The request shape is the contract with the control plane. These tests do
  // not assert an error class, because the error mapping belongs to #334.
  describe("tenant removal requests", () => {
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
    // (FST_ERR_CTP_EMPTY_JSON_BODY), and the client always sends that content type.
    it("purgeTenant sends a JSON body so that the control plane accepts the request", async () => {
      const client = makeClient({ cache: { enabled: false } });
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
        mockFetchResponse(undefined, 204),
      );

      await client.purgeTenant("t-1");

      const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
      expect(JSON.parse(init.body as string)).toEqual({});
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
