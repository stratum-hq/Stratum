import React from "react";
import { render, within, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { StratumContext, type StratumContextValue } from "../provider.js";
import { TenantSwitcher } from "../components/TenantSwitcher.js";

afterEach(() => {
  cleanup();
});

const mockTenant = {
  id: "tenant-1",
  name: "Acme Corp",
  slug: "acme-corp",
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

const mockApiCall = vi.fn().mockResolvedValue({ data: [mockTenant] });
const mockSwitchTenant = vi.fn().mockResolvedValue(undefined);

const mockContextValue: StratumContextValue = {
  currentTenant: mockTenant,
  tenantContext: null,
  loading: false,
  error: null,
  switchTenant: mockSwitchTenant,
  apiCall: mockApiCall,
  messages: {
    "tenantSwitcher.loading": "Loading...",
    "tenantSwitcher.placeholder": "Select tenant",
    "tenantSwitcher.searchPlaceholder": "Search tenants...",
    "tenantSwitcher.searchLabel": "Search tenants",
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

describe("TenantSwitcher", () => {
  it("renders without crashing and matches snapshot", async () => {
    const { container } = renderWithContext(<TenantSwitcher />);
    // Wait for loading state to clear
    await waitFor(() => {
      expect(within(container).queryByText("Loading...")).not.toBeInTheDocument();
    });
    expect(container).toMatchSnapshot();
  });

  it("displays current tenant name", async () => {
    const { container } = renderWithContext(<TenantSwitcher />);
    await waitFor(() => {
      expect(within(container).queryByText("Loading...")).not.toBeInTheDocument();
    });
    expect(within(container).getByText(/Acme Corp/)).toBeInTheDocument();
  });

  it("opens dropdown when trigger button is clicked", async () => {
    const { container } = renderWithContext(<TenantSwitcher />);
    await waitFor(() => {
      expect(within(container).queryByText("Loading...")).not.toBeInTheDocument();
    });
    const trigger = within(container).getByRole("button");
    fireEvent.click(trigger);
    expect(within(container).getByRole("listbox")).toBeInTheDocument();
  });
});
