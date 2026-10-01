import React from "react";
import { render, within, cleanup, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { StratumContext, type StratumContextValue } from "../provider.js";
import { ConfigInheritanceVisualizer } from "../components/ConfigInheritanceVisualizer.js";

afterEach(() => {
  cleanup();
});

const tenant = {
  id: "tenant-1",
  name: "Acme Corp",
  slug: "acme-corp",
  status: "active" as const,
  parent_id: "tenant-parent-1",
  ancestry_path: "/tenant-parent-1/tenant-1",
  depth: 1,
  isolation_strategy: "SHARED_RLS" as const,
  config: {},
  metadata: {},
  sort_order: 0,
  deleted_at: null,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
};

const config = {
  api_secret: {
    key: "api_secret",
    value: null,
    source_tenant_id: "tenant-parent-1",
    inherited: true,
    locked: false,
    sensitive: true,
    masked: true,
  },
};

const apiCall = vi.fn(async (path: string) => (path.endsWith("/descendants") ? [] : config));

const contextValue = {
  currentTenant: tenant,
  tenantContext: null,
  loading: false,
  error: null,
  switchTenant: vi.fn(),
  apiCall,
  messages: {},
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
} as unknown as StratumContextValue;

describe("ConfigInheritanceVisualizer", () => {
  it("shows an inherited sensitive value as masked instead of its value", async () => {
    const { container } = render(
      <StratumContext.Provider value={contextValue}>
        <ConfigInheritanceVisualizer />
      </StratumContext.Provider>,
    );
    await waitFor(() => {
      expect(within(container).getByText("api_secret")).toBeInTheDocument();
    });
    const row = within(container).getByText("api_secret").closest("tr")!;
    expect(row.textContent).toContain("Sensitive value set by an ancestor");
    expect(row.querySelector("code")).toBeNull();
  });
});
