import React from "react";
import { render, within, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { StratumContext, type StratumContextValue } from "../provider.js";
import { PermissionEditor } from "../components/PermissionEditor.js";

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

const mockPermissionsResponse = {
  "can_export": {
    policy_id: "policy-export-1",
    key: "can_export",
    value: true,
    mode: "INHERITED",
    source_tenant_id: "tenant-parent-1",
    inherited: true,
    locked: false,
    delegated: false,
    revocation_mode: "CASCADE",
  },
  "can_delete": {
    policy_id: "policy-delete-1",
    key: "can_delete",
    value: false,
    mode: "LOCKED",
    source_tenant_id: "tenant-1",
    inherited: false,
    locked: true,
    delegated: false,
    revocation_mode: "PERMANENT",
  },
};

const mockApiCall = vi.fn().mockResolvedValue(mockPermissionsResponse);

const mockContextValue: StratumContextValue = {
  currentTenant: mockTenant,
  tenantContext: null,
  loading: false,
  error: null,
  switchTenant: vi.fn().mockResolvedValue(undefined),
  apiCall: mockApiCall,
  messages: {
    "permissionEditor.error": "Error: {message}",
    "permissionEditor.columnKey": "Key",
    "permissionEditor.columnValue": "Value",
    "permissionEditor.columnMode": "Mode",
    "permissionEditor.columnSource": "Source",
    "permissionEditor.columnStatus": "Status",
    "permissionEditor.columnActions": "Actions",
    "permissionEditor.locked": "Locked",
    "permissionEditor.delegated": "Delegated",
    "permissionEditor.removeButton": "Remove",
    "permissionEditor.keyPlaceholder": "Permission key",
    "permissionEditor.keyLabel": "New permission key",
    "permissionEditor.modeLabel": "Mode",
    "permissionEditor.revocationModeLabel": "Revocation mode",
    "permissionEditor.addButton": "Add",
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

describe("PermissionEditor", () => {
  it("renders without crashing", async () => {
    const { container } = renderWithContext(<PermissionEditor />);
    await waitFor(() => {
      expect(within(container).getByRole("table")).toBeInTheDocument();
    });
    expect(container.querySelector(".stratum-permission-editor")).toBeInTheDocument();
  });

  it("renders a table with permission columns", async () => {
    const { container } = renderWithContext(<PermissionEditor />);
    await waitFor(() => {
      expect(within(container).getByRole("table")).toBeInTheDocument();
    });
  });

  it("renders mode select with default INHERITED option", async () => {
    const { container } = renderWithContext(<PermissionEditor />);
    await waitFor(() => {
      expect(within(container).getByRole("combobox", { name: /^mode$/i })).toBeInTheDocument();
    });
    const modeSelect = within(container).getByRole("combobox", { name: /^mode$/i });
    expect(modeSelect).toHaveValue("INHERITED");
  });

  it("renders add button disabled when key is empty", async () => {
    const { container } = renderWithContext(<PermissionEditor />);
    await waitFor(() => {
      expect(within(container).getByRole("button", { name: /add/i })).toBeInTheDocument();
    });
    const addButton = within(container).getByRole("button", { name: /add/i });
    expect(addButton).toBeDisabled();
  });

  it("enables add button when a key is typed", async () => {
    const { container } = renderWithContext(<PermissionEditor />);
    await waitFor(() => {
      expect(within(container).getByRole("textbox", { name: /new permission key/i })).toBeInTheDocument();
    });
    const keyInput = within(container).getByRole("textbox", { name: /new permission key/i });
    fireEvent.change(keyInput, { target: { value: "can_read" } });
    const addButton = within(container).getByRole("button", { name: /add/i });
    expect(addButton).not.toBeDisabled();
  });
});

describe("PermissionEditor remove", () => {
  /** Answers the permission list and records every mutation. */
  async function renderEditor() {
    const apiCall = vi.fn(async (_path: string, options?: RequestInit) =>
      (options?.method ?? "GET") === "GET" ? mockPermissionsResponse : {},
    );
    const value: StratumContextValue = {
      ...mockContextValue,
      apiCall: apiCall as unknown as StratumContextValue["apiCall"],
      messages: {},
    };
    const view = render(
      <StratumContext.Provider value={value}>
        <PermissionEditor />
      </StratumContext.Provider>,
    );
    await waitFor(() => expect(view.getByText("can_export")).toBeInTheDocument());
    const deleteCalls = () => apiCall.mock.calls.filter(([, options]) => options?.method === "DELETE");
    return { ...view, deleteCalls };
  }

  it("asks for confirmation and sends no request on the first click", async () => {
    const { getByRole, getByText, deleteCalls } = await renderEditor();
    fireEvent.click(getByRole("button", { name: "Remove" }));
    expect(getByText("Remove can_export?")).toBeInTheDocument();
    expect(deleteCalls()).toHaveLength(0);
  });

  it("sends the policy ID of the row, not the source tenant ID, after the confirmation", async () => {
    const { getByRole, deleteCalls } = await renderEditor();
    fireEvent.click(getByRole("button", { name: "Remove" }));
    fireEvent.click(getByRole("button", { name: "Yes, remove" }));
    await waitFor(() => expect(deleteCalls()).toHaveLength(1));
    expect(deleteCalls()[0][0]).toBe("/api/v1/tenants/tenant-1/permissions/policy-export-1");
  });

  it("keeps the permission and returns focus to Remove when the user selects Keep", async () => {
    const { getByRole, queryByText, deleteCalls } = await renderEditor();
    fireEvent.click(getByRole("button", { name: "Remove" }));
    const keep = getByRole("button", { name: "Keep" });
    expect(keep).toHaveFocus();
    fireEvent.click(keep);
    expect(queryByText("Remove can_export?")).toBeNull();
    expect(getByRole("button", { name: "Remove" })).toHaveFocus();
    expect(deleteCalls()).toHaveLength(0);
  });
});
