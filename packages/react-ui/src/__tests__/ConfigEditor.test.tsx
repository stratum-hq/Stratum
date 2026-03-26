import React from "react";
import { render, within, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { StratumContext, type StratumContextValue } from "../provider.js";
import { ConfigEditor } from "../components/ConfigEditor.js";

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

const mockConfigResponse = {
  "feature_flag": {
    value: true,
    source_tenant_id: "tenant-1",
    inherited: false,
    locked: false,
  },
  "max_users": {
    value: 100,
    source_tenant_id: "tenant-parent-1",
    inherited: true,
    locked: true,
  },
};

const mockApiCall = vi.fn().mockResolvedValue(mockConfigResponse);

const mockContextValue: StratumContextValue = {
  currentTenant: mockTenant,
  tenantContext: null,
  loading: false,
  error: null,
  switchTenant: vi.fn().mockResolvedValue(undefined),
  apiCall: mockApiCall,
  messages: {
    "configEditor.error": "Error: {message}",
    "configEditor.columnKey": "Key",
    "configEditor.columnValue": "Value",
    "configEditor.columnSource": "Source",
    "configEditor.columnStatus": "Status",
    "configEditor.columnActions": "Actions",
    "configEditor.locked": "Locked",
    "configEditor.inherited": "Inherited",
    "configEditor.own": "Own",
    "configEditor.editButton": "Edit",
    "configEditor.removeButton": "Remove",
    "configEditor.saveButton": "Save",
    "configEditor.cancelButton": "Cancel",
    "configEditor.editLabel": "Edit {key}",
    "configEditor.keyPlaceholder": "Key",
    "configEditor.valuePlaceholder": "Value",
    "configEditor.keyLabel": "New key",
    "configEditor.valueLabel": "New value",
    "configEditor.addButton": "Add",
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

describe("ConfigEditor", () => {
  it("renders without crashing and matches snapshot", async () => {
    const { container } = renderWithContext(<ConfigEditor />);
    await waitFor(() => {
      expect(within(container).getByRole("table")).toBeInTheDocument();
    });
    expect(container).toMatchSnapshot();
  });

  it("renders a table with config columns", async () => {
    const { container } = renderWithContext(<ConfigEditor />);
    await waitFor(() => {
      expect(within(container).getByRole("table")).toBeInTheDocument();
    });
  });

  it("renders add button disabled when key is empty", async () => {
    const { container } = renderWithContext(<ConfigEditor />);
    await waitFor(() => {
      expect(within(container).getByRole("button", { name: /add/i })).toBeInTheDocument();
    });
    const addButton = within(container).getByRole("button", { name: /add/i });
    expect(addButton).toBeDisabled();
  });

  it("enables add button when a key is typed", async () => {
    const { container } = renderWithContext(<ConfigEditor />);
    await waitFor(() => {
      expect(within(container).getByRole("textbox", { name: /new key/i })).toBeInTheDocument();
    });
    const keyInput = within(container).getByRole("textbox", { name: /new key/i });
    fireEvent.change(keyInput, { target: { value: "my_config_key" } });
    const addButton = within(container).getByRole("button", { name: /add/i });
    expect(addButton).not.toBeDisabled();
  });
});
