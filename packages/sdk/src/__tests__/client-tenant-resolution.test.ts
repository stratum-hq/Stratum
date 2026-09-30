import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StratumClient } from "../client.js";
import type { ResolvedTenantContext } from "@stratum-hq/core";

const CONTROL_PLANE_URL = "http://cp.stratum.test:3001";
const TENANT = "3f0c2a4e-8a52-4a3b-9d6e-1f2a3b4c5d6e";
const CHILD = "7b1d9c20-2f4e-4c6a-8b0d-9e8f7a6b5c4d";

function ctx(tenantId: string, ancestry = `/${tenantId}`): ResolvedTenantContext {
  return {
    tenant_id: tenantId,
    ancestry_path: ancestry,
    depth: ancestry.split("/").filter(Boolean).length - 1,
    resolved_config: {},
    resolved_permissions: {},
    isolation_strategy: "SHARED_RLS",
  };
}

function respond(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
    headers: new Headers(),
  } as unknown as Response;
}

function fetchMock() {
  return globalThis.fetch as ReturnType<typeof vi.fn>;
}

function requestedPath(call = 0): string {
  return new URL(fetchMock().mock.calls[call][0] as string).pathname;
}

describe("StratumClient tenant resolution", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("response validation", () => {
    it("rejects a context response that has no tenant_id", async () => {
      const client = new StratumClient({ controlPlaneUrl: CONTROL_PLANE_URL, apiKey: "k" });
      fetchMock().mockResolvedValueOnce(
        respond({ tenant: { id: TENANT }, config: {}, permissions: {}, ancestors: [] }),
      );
      await expect(client.resolveTenant(TENANT)).rejects.toThrow(/invalid tenant context/i);
    });

    it("rejects a context response for a different tenant than the one requested", async () => {
      const client = new StratumClient({ controlPlaneUrl: CONTROL_PLANE_URL, apiKey: "k" });
      fetchMock().mockResolvedValueOnce(respond(ctx(CHILD)));
      await expect(client.resolveTenant(TENANT)).rejects.toThrow(/invalid tenant context/i);
    });

    it("does not cache a rejected context response", async () => {
      const client = new StratumClient({ controlPlaneUrl: CONTROL_PLANE_URL, apiKey: "k" });
      fetchMock()
        .mockResolvedValueOnce(respond({ unexpected: true }))
        .mockResolvedValueOnce(respond(ctx(TENANT)));
      await expect(client.resolveTenant(TENANT)).rejects.toThrow();
      await expect(client.resolveTenant(TENANT)).resolves.toEqual(ctx(TENANT));
    });

    it("accepts a context whose tenant_id differs from the request only in letter case", async () => {
      const client = new StratumClient({ controlPlaneUrl: CONTROL_PLANE_URL, apiKey: "k" });
      fetchMock().mockResolvedValueOnce(respond(ctx(TENANT)));
      await expect(client.resolveTenant(TENANT.toUpperCase())).resolves.toEqual(ctx(TENANT));
    });
  });

  describe("request path construction", () => {
    it.each([
      ["../audit-logs?", "dot segment with query"],
      [`${TENANT}/export?`, "extra segment with query"],
      ["../api-keys#", "dot segment with fragment"],
      ["..\\api-keys", "backslash separator"],
    ])("keeps the tenant ID %j (%s) inside the /context path", async (tenantId) => {
      const client = new StratumClient({ controlPlaneUrl: CONTROL_PLANE_URL, apiKey: "k", cache: { enabled: false } });
      fetchMock().mockResolvedValue(respond({ data: [] }));
      await client.resolveTenant(tenantId).catch(() => undefined);
      if (fetchMock().mock.calls.length > 0) {
        const path = requestedPath();
        expect(path.startsWith("/api/v1/tenants/")).toBe(true);
        expect(path.endsWith("/context")).toBe(true);
        expect(path.split("/")).toHaveLength(6);
      }
    });

    it.each([".", ".."])("refuses the dot-segment tenant ID %j without sending a request", async (tenantId) => {
      const client = new StratumClient({ controlPlaneUrl: CONTROL_PLANE_URL, apiKey: "k" });
      await expect(client.resolveTenant(tenantId)).rejects.toThrow();
      expect(fetchMock()).not.toHaveBeenCalled();
    });

    it("keeps IDs inside their path segment for the other ID-taking methods", async () => {
      const client = new StratumClient({ controlPlaneUrl: CONTROL_PLANE_URL, apiKey: "k" });
      fetchMock().mockResolvedValue(respond({}));
      const hostile = "../../api-keys?";
      await client.getTenant(hostile).catch(() => undefined);
      await client.getWebhook(hostile).catch(() => undefined);
      await client.updateRegion(hostile, {}).catch(() => undefined);
      await client.rotateApiKey(hostile).catch(() => undefined);
      await client.getTenantTree(hostile).catch(() => undefined);
      const paths = fetchMock().mock.calls.map((_, i) => requestedPath(i));
      expect(paths).toEqual([
        "/api/v1/tenants/..%2F..%2Fapi-keys%3F",
        "/api/v1/webhooks/..%2F..%2Fapi-keys%3F",
        "/api/v1/regions/..%2F..%2Fapi-keys%3F",
        "/api/v1/api-keys/..%2F..%2Fapi-keys%3F/rotate",
        "/api/v1/tenants/..%2F..%2Fapi-keys%3F/descendants",
      ]);
    });
  });

  describe("cache invalidation", () => {
    it("moveTenant drops cached contexts of the moved tenant's descendants", async () => {
      const client = new StratumClient({ controlPlaneUrl: CONTROL_PLANE_URL, apiKey: "k" });
      fetchMock()
        .mockResolvedValueOnce(respond(ctx(CHILD, `/${TENANT}/${CHILD}`)))
        .mockResolvedValueOnce(respond({}))
        .mockResolvedValueOnce(respond(ctx(CHILD, `/other/${TENANT}/${CHILD}`)));
      await client.resolveTenant(CHILD);
      await client.moveTenant(TENANT, { new_parent_id: "0e9d8c7b-6a5f-4e3d-2c1b-0a9f8e7d6c5b" });
      const after = await client.resolveTenant(CHILD);
      expect(fetchMock()).toHaveBeenCalledTimes(3);
      expect(after.ancestry_path).toBe(`/other/${TENANT}/${CHILD}`);
    });

    it("invalidateCache clears an entry that was cached under a differently cased ID", async () => {
      const client = new StratumClient({ controlPlaneUrl: CONTROL_PLANE_URL, apiKey: "k" });
      fetchMock()
        .mockResolvedValueOnce(respond(ctx(TENANT)))
        .mockResolvedValueOnce(respond(ctx(TENANT)));
      await client.resolveTenant(TENANT.toUpperCase());
      client.invalidateCache(TENANT);
      await client.resolveTenant(TENANT.toUpperCase());
      expect(fetchMock()).toHaveBeenCalledTimes(2);
    });
  });
});
