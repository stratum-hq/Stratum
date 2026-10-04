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
  "can_invite": {
    policy_id: "policy-invite-1",
    key: "can_invite",
    value: true,
    mode: "INHERITED",
    source_tenant_id: "tenant-1",
    inherited: false,
    locked: false,
    delegated: false,
    revocation_mode: "CASCADE",
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
    await waitFor(() => expect(view.getByText("can_invite")).toBeInTheDocument());
    const deleteCalls = () => apiCall.mock.calls.filter(([, options]) => options?.method === "DELETE");
    return { ...view, deleteCalls };
  }

  it("asks for confirmation and sends no request on the first click", async () => {
    const { getByRole, getByText, deleteCalls } = await renderEditor();
    fireEvent.click(getByRole("button", { name: "Remove" }));
    expect(getByText("Remove can_invite?")).toBeInTheDocument();
    expect(deleteCalls()).toHaveLength(0);
  });

  it("sends the policy ID of the row, not the source tenant ID, after the confirmation", async () => {
    const { getByRole, deleteCalls } = await renderEditor();
    fireEvent.click(getByRole("button", { name: "Remove" }));
    fireEvent.click(getByRole("button", { name: "Yes, remove" }));
    await waitFor(() => expect(deleteCalls()).toHaveLength(1));
    expect(deleteCalls()[0][0]).toBe("/api/v1/tenants/tenant-1/permissions/policy-invite-1");
  });

  it("keeps the permission and returns focus to Remove when the user selects Keep", async () => {
    const { getByRole, queryByText, deleteCalls } = await renderEditor();
    fireEvent.click(getByRole("button", { name: "Remove" }));
    const keep = getByRole("button", { name: "Keep" });
    expect(keep).toHaveFocus();
    fireEvent.click(keep);
    expect(queryByText("Remove can_invite?")).toBeNull();
    expect(getByRole("button", { name: "Remove" })).toHaveFocus();
    expect(deleteCalls()).toHaveLength(0);
  });
});

/** Returns an apiCall mock that knows the permission and ancestors routes and records each mutation. */
function routedApiCall({
  ancestors = [{ id: "tenant-parent-1", name: "Parent Org", slug: "parent-org", depth: 0 }] as unknown,
  mutationError = null as Error | null,
} = {}) {
  return vi.fn(async (path: string, options?: RequestInit) => {
    if (options?.method && options.method !== "GET") {
      if (mutationError) throw mutationError;
      return {};
    }
    if (path.endsWith("/ancestors")) {
      if (ancestors instanceof Error) throw ancestors;
      return ancestors;
    }
    if (path.endsWith("/permissions")) return mockPermissionsResponse;
    return {};
  });
}

function renderRouted(apiCall: ReturnType<typeof routedApiCall>) {
  const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };
  const view = render(
    <StratumContext.Provider
      value={{ ...mockContextValue, messages: {}, toast, apiCall: apiCall as unknown as StratumContextValue["apiCall"] }}
    >
      <PermissionEditor />
    </StratumContext.Provider>,
  );
  return { ...view, toast };
}

async function rowFor(container: HTMLElement, key: string) {
  await waitFor(() => expect(within(container).getByText(key)).toBeInTheDocument());
  return within(container).getByText(key).closest("tr")!;
}

describe("PermissionEditor row ownership", () => {
  it("offers Remove on a policy that the current tenant owns", async () => {
    const { container } = renderRouted(routedApiCall());
    const own = await rowFor(container, "can_invite");
    expect(within(own).getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("offers no Remove on a policy that an ancestor set, and names that ancestor", async () => {
    const { container } = renderRouted(routedApiCall());
    const inherited = await rowFor(container, "can_export");
    expect(within(inherited).queryByRole("button", { name: "Remove" })).toBeNull();
    await waitFor(() => expect(inherited.textContent).toContain("Set by Parent Org"));
  });

  it("offers no Remove on a locked policy", async () => {
    const { container } = renderRouted(routedApiCall());
    const locked = await rowFor(container, "can_delete");
    expect(within(locked).queryByRole("button", { name: "Remove" })).toBeNull();
  });
});

describe("PermissionEditor source tenant", () => {
  it("shows the name of the tenant that set each policy instead of its ID", async () => {
    const { container } = renderRouted(routedApiCall());
    const inherited = await rowFor(container, "can_export");
    await waitFor(() =>
      expect(inherited.querySelector(".stratum-permission-editor__source")!.textContent).toBe("Parent Org"),
    );
    const own = await rowFor(container, "can_invite");
    expect(own.querySelector(".stratum-permission-editor__source")!.textContent).toBe("Acme Corp");
  });

  it("falls back to a short tenant ID when the ancestors request fails", async () => {
    const { container } = renderRouted(routedApiCall({ ancestors: new Error("forbidden") }));
    const inherited = await rowFor(container, "can_export");
    await waitFor(() =>
      expect(inherited.querySelector(".stratum-permission-editor__source")!.textContent).toBe("tenant-p…"),
    );
    expect(inherited.textContent).toContain("Set by tenant-p…");
  });
});

describe("PermissionEditor error toasts", () => {
  it("states a failed add in plain language and puts the raw message in the detail", async () => {
    const { container, toast } = renderRouted(routedApiCall({ mutationError: new Error("HTTP 409: conflict") }));
    await rowFor(container, "can_invite");
    fireEvent.change(within(container).getByRole("textbox", { name: "New permission key" }), {
      target: { value: "can_read" },
    });
    fireEvent.click(within(container).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith('Could not add "can_read".', "HTTP 409: conflict");
  });

  it("states a failed remove in plain language and puts the raw message in the detail", async () => {
    const { container, toast } = renderRouted(routedApiCall({ mutationError: new Error("HTTP 404: not found") }));
    const own = await rowFor(container, "can_invite");
    fireEvent.click(within(own).getByRole("button", { name: "Remove" }));
    fireEvent.click(within(own).getByRole("button", { name: "Yes, remove" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith(
      'Could not remove "can_invite". The permission is unchanged.',
      "HTTP 404: not found",
    );
  });
});
