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
  it("renders without crashing", async () => {
    const { container } = renderWithContext(<ConfigEditor />);
    await waitFor(() => {
      expect(within(container).getByRole("table")).toBeInTheDocument();
    });
    expect(container.querySelector(".stratum-config-editor")).toBeInTheDocument();
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

describe("ConfigEditor with a masked sensitive value", () => {
  const maskedResponse = {
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

  function renderMasked() {
    const apiCall = vi.fn().mockResolvedValue(maskedResponse);
    return render(
      <StratumContext.Provider value={{ ...mockContextValue, apiCall }}>
        <ConfigEditor />
      </StratumContext.Provider>,
    );
  }

  it("shows an inherited sensitive value as masked instead of its value", async () => {
    const { container } = renderMasked();
    await waitFor(() => {
      expect(within(container).getByText("api_secret")).toBeInTheDocument();
    });
    const row = within(container).getByText("api_secret").closest("tr")!;
    expect(row.textContent).toContain("Sensitive value set by an ancestor");
    expect(row.querySelector("code")).toBeNull();
    expect(row.textContent).not.toContain("null");
  });

  it("does not pre-fill the edit field when overriding a masked value", async () => {
    const { container } = renderMasked();
    await waitFor(() => {
      expect(within(container).getByText("api_secret")).toBeInTheDocument();
    });
    fireEvent.click(within(container).getByRole("button", { name: "Edit" }));
    const input = within(container).getByRole("textbox", { name: "Edit api_secret" }) as HTMLInputElement;
    expect(input.value).toBe("");
  });
});

/** Returns an apiCall mock that knows the config and ancestors routes and records each PUT. */
function routedApiCall(
  ancestors: unknown = [{ id: "tenant-parent-1", name: "Parent Org", slug: "parent-org", depth: 0 }],
  configResponse: unknown = mockConfigResponse,
) {
  return vi.fn(async (path: string, options?: RequestInit) => {
    if (options?.method && options.method !== "GET") return {};
    if (path.endsWith("/ancestors")) {
      if (ancestors instanceof Error) throw ancestors;
      return ancestors;
    }
    if (path.endsWith("/config")) return configResponse;
    return {};
  });
}

function renderRouted(apiCall: ReturnType<typeof routedApiCall>) {
  return render(
    <StratumContext.Provider value={{ ...mockContextValue, apiCall: apiCall as unknown as StratumContextValue["apiCall"] }}>
      <ConfigEditor />
    </StratumContext.Provider>,
  );
}

function putBodies(apiCall: ReturnType<typeof routedApiCall>) {
  return apiCall.mock.calls
    .filter(([, options]) => options?.method === "PUT")
    .map(([path, options]) => ({ path, body: JSON.parse(String(options?.body)) }));
}

async function rowFor(container: HTMLElement, key: string) {
  await waitFor(() => expect(within(container).getByText(key)).toBeInTheDocument());
  return within(container).getByText(key).closest("tr")!;
}

describe("ConfigEditor source tenant", () => {
  it("shows the name of the tenant that set each value instead of its ID", async () => {
    const { container } = renderRouted(routedApiCall());
    const inherited = await rowFor(container, "max_users");
    await waitFor(() => expect(inherited.textContent).toContain("Parent Org"));
    expect(inherited.textContent).not.toContain("tenant-p");
    const own = await rowFor(container, "feature_flag");
    expect(own.querySelector(".stratum-config-editor__source")!.textContent).toBe("Acme Corp");
  });

  it("says which tenant locked a locked row", async () => {
    const { container } = renderRouted(routedApiCall());
    const locked = await rowFor(container, "max_users");
    await waitFor(() => expect(locked.textContent).toContain("Locked by Parent Org"));
  });

  it("falls back to a short tenant ID when the ancestors request fails", async () => {
    const { container } = renderRouted(routedApiCall(new Error("forbidden")));
    const inherited = await rowFor(container, "max_users");
    await waitFor(() =>
      expect(inherited.querySelector(".stratum-config-editor__source")!.textContent).toBe("tenant-p…"),
    );
    expect(inherited.textContent).toContain("Locked by tenant-p…");
  });
});

describe("ConfigEditor inline edit", () => {
  async function startEdit() {
    const apiCall = routedApiCall();
    const { container } = renderRouted(apiCall);
    const row = await rowFor(container, "feature_flag");
    fireEvent.click(within(row).getByRole("button", { name: "Edit" }));
    const input = within(row).getByRole("textbox", { name: "Edit feature_flag" }) as HTMLInputElement;
    return { apiCall, container, row, input };
  }

  it("saves a valid JSON value as parsed JSON", async () => {
    const { apiCall, row, input } = await startEdit();
    fireEvent.change(input, { target: { value: "42" } });
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(putBodies(apiCall)).toHaveLength(1));
    expect(putBodies(apiCall)[0].body).toEqual({ value: 42, locked: false });
  });

  it("does not save invalid JSON and shows an inline message with a save-as-string choice", async () => {
    const { apiCall, row, input } = await startEdit();
    fireEvent.change(input, { target: { value: "hello world" } });
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));
    const message = await within(row).findByRole("alert");
    expect(message.textContent).toContain("not valid JSON");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toBe(message.id);
    expect(putBodies(apiCall)).toHaveLength(0);

    fireEvent.click(within(row).getByRole("button", { name: "Save as string" }));
    await waitFor(() => expect(putBodies(apiCall)).toHaveLength(1));
    expect(putBodies(apiCall)[0].body).toEqual({ value: "hello world", locked: false });
  });

  it("clears the invalid-JSON message when the user changes the value", async () => {
    const { row, input } = await startEdit();
    fireEvent.change(input, { target: { value: "{oops" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await within(row).findByRole("alert");
    fireEvent.change(input, { target: { value: "{\"ok\":1}" } });
    expect(within(row).queryByRole("alert")).toBeNull();
    expect(input).not.toHaveAttribute("aria-invalid", "true");
  });

  it("cancels the inline edit on Escape without saving", async () => {
    const { apiCall, row, input } = await startEdit();
    fireEvent.change(input, { target: { value: "false" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(within(row).queryByRole("textbox")).toBeNull();
    expect(row.querySelector("code")!.textContent).toBe("true");
    expect(putBodies(apiCall)).toHaveLength(0);
  });
});

describe("ConfigEditor add", () => {
  it("does not add invalid JSON until the user chooses to save it as a string", async () => {
    const apiCall = routedApiCall();
    const { container } = renderRouted(apiCall);
    await rowFor(container, "feature_flag");
    fireEvent.change(within(container).getByRole("textbox", { name: "New key" }), { target: { value: "greeting" } });
    fireEvent.change(within(container).getByRole("textbox", { name: "New value" }), { target: { value: "hi there" } });
    fireEvent.click(within(container).getByRole("button", { name: "Add" }));
    const message = await within(container).findByRole("alert");
    expect(message.textContent).toContain("not valid JSON");
    expect(putBodies(apiCall)).toHaveLength(0);

    fireEvent.click(within(container).getByRole("button", { name: "Save as string" }));
    await waitFor(() => expect(putBodies(apiCall)).toHaveLength(1));
    expect(putBodies(apiCall)[0]).toEqual({
      path: "/api/v1/tenants/tenant-1/config/greeting",
      body: { value: "hi there", locked: false },
    });
  });
});

describe("ConfigEditor override of an inherited sensitive key", () => {
  const sensitiveResponse = {
    ...mockConfigResponse,
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

  it("sends sensitive: true when it overrides an inherited sensitive value", async () => {
    const apiCall = routedApiCall(undefined, sensitiveResponse);
    const { container } = renderRouted(apiCall);
    const row = await rowFor(container, "api_secret");
    fireEvent.click(within(row).getByRole("button", { name: "Edit" }));
    fireEvent.change(within(row).getByRole("textbox", { name: "Edit api_secret" }), {
      target: { value: "\"child-value\"" },
    });
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(putBodies(apiCall)).toHaveLength(1));
    expect(putBodies(apiCall)[0]).toEqual({
      path: "/api/v1/tenants/tenant-1/config/api_secret",
      body: { value: "child-value", locked: false, sensitive: true },
    });
  });

  it("sends sensitive: true when the add row names an inherited sensitive key", async () => {
    const apiCall = routedApiCall(undefined, sensitiveResponse);
    const { container } = renderRouted(apiCall);
    await rowFor(container, "api_secret");
    fireEvent.change(within(container).getByRole("textbox", { name: "New key" }), { target: { value: "api_secret" } });
    fireEvent.change(within(container).getByRole("textbox", { name: "New value" }), { target: { value: "\"x\"" } });
    fireEvent.click(within(container).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(putBodies(apiCall)).toHaveLength(1));
    expect(putBodies(apiCall)[0].body).toEqual({ value: "x", locked: false, sensitive: true });
  });

  it("sends no sensitive flag when it overrides an inherited value that is not sensitive", async () => {
    const apiCall = routedApiCall(undefined, {
      ...sensitiveResponse,
      theme: { value: "dark", source_tenant_id: "tenant-parent-1", inherited: true, locked: false },
    });
    const { container } = renderRouted(apiCall);
    const row = await rowFor(container, "theme");
    fireEvent.click(within(row).getByRole("button", { name: "Edit" }));
    fireEvent.change(within(row).getByRole("textbox", { name: "Edit theme" }), { target: { value: "\"light\"" } });
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(putBodies(apiCall)).toHaveLength(1));
    expect(putBodies(apiCall)[0].body).toEqual({ value: "light", locked: false });
  });
});

describe("ConfigEditor narrow layout", () => {
  it("labels each cell with its column name so a stacked card stays readable", async () => {
    const { container } = renderRouted(routedApiCall());
    const row = await rowFor(container, "feature_flag");
    const labels = Array.from(row.querySelectorAll("td")).map((td) => td.getAttribute("data-label"));
    expect(labels).toEqual(["Key", "Value", "Source", "Status", "Actions"]);
  });
});

describe("ConfigEditor lock", () => {
  const lockResponse = {
    ...mockConfigResponse,
    region: { value: "eu", source_tenant_id: "tenant-1", inherited: false, locked: true },
    api_key: { value: "s3cret", source_tenant_id: "tenant-1", inherited: false, locked: false, sensitive: true },
    theme: { value: "dark", source_tenant_id: "tenant-parent-1", inherited: true, locked: false },
  };

  function renderLock() {
    const apiCall = routedApiCall(undefined, lockResponse);
    const { container } = renderRouted(apiCall);
    return { apiCall, container };
  }

  it("locks a key that the current tenant owns", async () => {
    const { apiCall, container } = renderLock();
    const row = await rowFor(container, "feature_flag");
    fireEvent.click(within(row).getByRole("button", { name: "Lock" }));
    await waitFor(() => expect(putBodies(apiCall)).toHaveLength(1));
    expect(putBodies(apiCall)[0]).toEqual({
      path: "/api/v1/tenants/tenant-1/config/feature_flag",
      body: { value: true, locked: true },
    });
  });

  it("unlocks a key that the current tenant locked", async () => {
    const { apiCall, container } = renderLock();
    const row = await rowFor(container, "region");
    expect(row.textContent).not.toContain("Locked by");
    fireEvent.click(within(row).getByRole("button", { name: "Unlock" }));
    await waitFor(() => expect(putBodies(apiCall)).toHaveLength(1));
    expect(putBodies(apiCall)[0]).toEqual({
      path: "/api/v1/tenants/tenant-1/config/region",
      body: { value: "eu", locked: false },
    });
  });

  it("keeps the lock when the current tenant edits a key it locked", async () => {
    const { apiCall, container } = renderLock();
    const row = await rowFor(container, "region");
    fireEvent.click(within(row).getByRole("button", { name: "Edit" }));
    fireEvent.change(within(row).getByRole("textbox", { name: "Edit region" }), { target: { value: "\"us\"" } });
    fireEvent.click(within(row).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(putBodies(apiCall)).toHaveLength(1));
    expect(putBodies(apiCall)[0].body).toEqual({ value: "us", locked: true });
  });

  it("keeps a sensitive key sensitive when it locks the key", async () => {
    const { apiCall, container } = renderLock();
    const row = await rowFor(container, "api_key");
    fireEvent.click(within(row).getByRole("button", { name: "Lock" }));
    await waitFor(() => expect(putBodies(apiCall)).toHaveLength(1));
    expect(putBodies(apiCall)[0].body).toEqual({ value: "s3cret", locked: true, sensitive: true });
  });

  it("shows no lock control and no edit on a key that an ancestor locked", async () => {
    const { container } = renderLock();
    const row = await rowFor(container, "max_users");
    await waitFor(() => expect(row.textContent).toContain("Locked by Parent Org"));
    expect(within(row).queryByRole("button")).toBeNull();
  });

  it("shows no lock control on a key that the current tenant inherits", async () => {
    const { container } = renderLock();
    const row = await rowFor(container, "theme");
    expect(within(row).getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /lock/i })).toBeNull();
  });

  it("adds a key locked for descendants when the user selects the lock option", async () => {
    const { apiCall, container } = renderLock();
    await rowFor(container, "feature_flag");
    fireEvent.change(within(container).getByRole("textbox", { name: "New key" }), { target: { value: "tier" } });
    fireEvent.change(within(container).getByRole("textbox", { name: "New value" }), { target: { value: "\"gold\"" } });
    const lockOption = within(container).getByRole("checkbox", { name: "Lock for descendants" });
    expect(lockOption).not.toBeChecked();
    fireEvent.click(lockOption);
    fireEvent.click(within(container).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(putBodies(apiCall)).toHaveLength(1));
    expect(putBodies(apiCall)[0]).toEqual({
      path: "/api/v1/tenants/tenant-1/config/tier",
      body: { value: "gold", locked: true },
    });
    // The reload replaces the form, so read the checkbox again.
    await waitFor(() =>
      expect(within(container).getByRole("checkbox", { name: "Lock for descendants" })).not.toBeChecked(),
    );
  });
});
