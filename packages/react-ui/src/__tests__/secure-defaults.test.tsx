import React, { useEffect } from "react";
import { render, cleanup, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { StratumProvider, StratumContext, type StratumContextValue } from "../provider.js";
import { useConfig } from "../hooks/use-config.js";
import { usePermissions } from "../hooks/use-permissions.js";
import { useWebhooks } from "../hooks/use-webhooks.js";
import { TenantThemeProvider } from "../components/TenantThemeProvider.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const BASE = "http://cp.example";

/** The path a request to `url` actually reaches, after URL normalisation. */
function reachedPath(url: string): string {
  return new URL(url, BASE).pathname;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const tenant = {
  id: "tenant-1",
  name: "Acme",
  slug: "acme",
  status: "active" as const,
  parent_id: null,
  ancestry_path: "tenant-1",
  depth: 0,
  isolation_strategy: "SHARED_RLS" as const,
  config: {},
  metadata: {},
  sort_order: 0,
  deleted_at: null,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
};

function contextWith(apiCall: StratumContextValue["apiCall"]): StratumContextValue {
  return {
    currentTenant: tenant,
    tenantContext: null,
    loading: false,
    error: null,
    switchTenant: vi.fn().mockResolvedValue(undefined),
    apiCall,
    messages: {},
    toast: vi.fn() as unknown as StratumContextValue["toast"],
  };
}

describe("React hooks keep interpolated IDs and keys inside their path segment", () => {
  it("StratumProvider.switchTenant cannot be steered to another endpoint by the tenant ID", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ...tenant }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StratumProvider controlPlaneUrl={BASE} initialTenantId="../audit-logs?x=">
        <div />
      </StratumProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    for (const [url] of fetchMock.mock.calls as unknown as [string][]) {
      expect(reachedPath(url)).toMatch(/^\/api\/v1\/tenants\/[^/]+(\/(config|permissions))?$/);
      expect(new URL(url).search).toBe("");
    }
  });

  it("useConfig deleteConfigValue targets the config entry, not another resource", async () => {
    const apiCall = vi.fn().mockResolvedValue({});
    let del: ((key: string) => Promise<void>) | undefined;
    function Probe() {
      const { deleteConfigValue } = useConfig();
      useEffect(() => {
        del = deleteConfigValue;
      });
      return null;
    }
    render(
      <StratumContext.Provider value={contextWith(apiCall)}>
        <Probe />
      </StratumContext.Provider>,
    );
    await waitFor(() => expect(del).toBeDefined());
    await del!("../../victim-tenant");

    const deleteCall = apiCall.mock.calls.find((c) => c[1]?.method === "DELETE");
    expect(deleteCall).toBeDefined();
    expect(reachedPath(deleteCall![0])).toBe("/api/v1/tenants/tenant-1/config/..%2F..%2Fvictim-tenant");
  });

  it("useConfig setConfigValue targets the config entry, not another resource", async () => {
    const apiCall = vi.fn().mockResolvedValue({});
    let set: ((key: string, value: unknown) => Promise<void>) | undefined;
    function Probe() {
      const { setConfigValue } = useConfig();
      useEffect(() => {
        set = setConfigValue;
      });
      return null;
    }
    render(
      <StratumContext.Provider value={contextWith(apiCall)}>
        <Probe />
      </StratumContext.Provider>,
    );
    await waitFor(() => expect(set).toBeDefined());
    await set!("a/../../../webhooks", 1);

    const putCall = apiCall.mock.calls.find((c) => c[1]?.method === "PUT");
    expect(reachedPath(putCall![0])).toBe("/api/v1/tenants/tenant-1/config/a%2F..%2F..%2F..%2Fwebhooks");
  });

  it("usePermissions deletePermission and useWebhooks deleteWebhook keep IDs in one segment", async () => {
    const apiCall = vi.fn().mockResolvedValue([]);
    let delPerm: ((id: string) => Promise<void>) | undefined;
    let delHook: ((id: string) => Promise<void>) | undefined;
    function Probe() {
      const perms = usePermissions();
      const hooks = useWebhooks();
      useEffect(() => {
        delPerm = perms.deletePermission;
        delHook = hooks.deleteWebhook;
      });
      return null;
    }
    render(
      <StratumContext.Provider value={contextWith(apiCall)}>
        <Probe />
      </StratumContext.Provider>,
    );
    await waitFor(() => expect(delPerm && delHook).toBeDefined());
    await delPerm!("../../../api-keys");
    await delHook!("../tenants/tenant-2");

    const deletes = apiCall.mock.calls.filter((c) => c[1]?.method === "DELETE").map((c) => reachedPath(c[0]));
    expect(deletes).toEqual([
      "/api/v1/tenants/tenant-1/permissions/..%2F..%2F..%2Fapi-keys",
      "/api/v1/webhooks/..%2Ftenants%2Ftenant-2",
    ]);
  });
});

describe("StratumProvider without an API key", () => {
  it("sends no X-API-Key header, so it can sit behind a server-side proxy", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ ...tenant }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StratumProvider controlPlaneUrl="/api/stratum" initialTenantId="tenant-1">
        <div />
      </StratumProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    for (const call of fetchMock.mock.calls) {
      const headers = (call[1]?.headers ?? {}) as Record<string, string>;
      expect(Object.keys(headers)).not.toContain("X-API-Key");
    }
  });
});

describe("TenantThemeProvider customCss", () => {
  function styleText(container: HTMLElement): string {
    return Array.from(container.querySelectorAll("style"))
      .map((s) => s.textContent ?? "")
      .join("\n");
  }

  it("keeps plain declarations inside the tenant's scope", () => {
    const { container } = render(
      <TenantThemeProvider branding={{ customCss: "color: red; font-weight: 600;" }}>
        <span />
      </TenantThemeProvider>,
    );
    const css = styleText(container);
    expect(css).toMatch(/^\[data-stratum-theme-[^\]]+\] \{ color: red; font-weight: 600; \}$/);
  });

  it("does not let customCss close the scope block and style the whole page", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { container } = render(
      <TenantThemeProvider branding={{ customCss: "} body * { display: none } .x {" }}>
        <span />
      </TenantThemeProvider>,
    );
    expect(styleText(container)).not.toContain("body");
  });

  it("does not let customCss load external resources", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { container } = render(
      <TenantThemeProvider branding={{ customCss: "background: url(https://attacker.example/x)" }}>
        <span />
      </TenantThemeProvider>,
    );
    expect(styleText(container)).not.toContain("attacker.example");
  });
});
