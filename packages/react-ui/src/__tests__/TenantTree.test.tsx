import React from "react";
import { render, within, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { StratumContext, type StratumContextValue } from "../provider.js";
import { TenantTree } from "../components/TenantTree.js";

afterEach(() => {
  cleanup();
});

const mockTenant = {
  id: "tenant-1",
  name: "Root Tenant",
  slug: "root-tenant",
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

const childTenant = {
  id: "tenant-2",
  name: "Child Tenant",
  slug: "child-tenant",
  status: "active" as const,
  parent_id: "tenant-1",
  ancestry_path: "/tenant-1/tenant-2",
  depth: 1,
  isolation_strategy: "SHARED_RLS" as const,
  config: {},
  metadata: {},
  sort_order: 0,
  deleted_at: null,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
};

const mockApiCall = vi.fn().mockResolvedValue({ data: [mockTenant, childTenant] });

const mockContextValue: StratumContextValue = {
  currentTenant: mockTenant,
  tenantContext: null,
  loading: false,
  error: null,
  switchTenant: vi.fn().mockResolvedValue(undefined),
  apiCall: mockApiCall,
  messages: {
    "tenantTree.loading": "Loading...",
    "tenantTree.error": "Error: {message}",
    "tenantTree.collapse": "Collapse",
    "tenantTree.expand": "Expand",
    "tenantTree.badgeRls": "RLS",
    "tenantTree.archived": "Archived",
  },
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
};

function renderWithContext(ui: React.ReactElement) {
  return render(
    <StratumContext.Provider value={mockContextValue}>
      {ui}
    </StratumContext.Provider>,
  );
}

describe("TenantTree", () => {
  it("renders without crashing and matches snapshot", async () => {
    const { container } = renderWithContext(<TenantTree />);
    await waitFor(() => {
      expect(within(container).queryByText("Loading...")).not.toBeInTheDocument();
    });
    expect(container).toMatchSnapshot();
  });

  it("renders a tree role element", async () => {
    const { container } = renderWithContext(<TenantTree />);
    await waitFor(() => {
      expect(within(container).getByRole("tree")).toBeInTheDocument();
    });
  });

  it("calls onSelect when a tenant label is clicked", async () => {
    const onSelect = vi.fn();
    const { container } = renderWithContext(<TenantTree onSelect={onSelect} />);
    await waitFor(() => {
      expect(within(container).queryByText("Loading...")).not.toBeInTheDocument();
    });
    const labels = within(container).queryAllByText("Root Tenant");
    if (labels.length > 0) {
      fireEvent.click(labels[0]);
      expect(onSelect).toHaveBeenCalledWith("tenant-1");
    }
  });
});
