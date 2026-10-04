import React from "react";
import { render, within, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { StratumContext, type StratumContextValue } from "../provider.js";
import { ConfigEditor } from "../components/ConfigEditor.js";
import { WebhookEditor } from "../components/WebhookEditor.js";

afterEach(() => {
  cleanup();
});

const tenant = {
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

const configResponse = {
  feature_flag: { value: true, source_tenant_id: "tenant-1", inherited: false, locked: false },
};

const webhooksResponse = [
  {
    id: "wh-1",
    tenant_id: "tenant-1",
    url: "https://example.com/hook",
    events: ["tenant.created"],
    active: true,
    secret: "",
    created_at: "2024-01-01T00:00:00Z",
  },
];

/** Returns an apiCall mock that answers the list requests and records every mutation. */
function makeApiCall(failMutations = false) {
  return vi.fn(async (path: string, options?: RequestInit) => {
    const method = options?.method ?? "GET";
    if (method !== "GET") {
      if (failMutations) throw new Error("connection reset by peer");
      return {};
    }
    if (path.endsWith("/config")) return configResponse;
    if (path.endsWith("/ancestors")) return [];
    if (path.startsWith("/api/v1/webhooks")) return webhooksResponse;
    return {};
  });
}

function renderWith(ui: React.ReactElement, apiCall: ReturnType<typeof makeApiCall>) {
  const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };
  const value: StratumContextValue = {
    currentTenant: tenant,
    tenantContext: null,
    loading: false,
    error: null,
    switchTenant: vi.fn().mockResolvedValue(undefined),
    apiCall: apiCall as unknown as StratumContextValue["apiCall"],
    messages: {},
    toast,
  };
  const result = render(<StratumContext.Provider value={value}>{ui}</StratumContext.Provider>);
  return { ...result, toast };
}

function deleteCalls(apiCall: ReturnType<typeof makeApiCall>) {
  return apiCall.mock.calls.filter(([, options]) => options?.method === "DELETE");
}

describe("ConfigEditor remove", () => {
  async function renderEditor(failMutations = false) {
    const apiCall = makeApiCall(failMutations);
    const view = renderWith(<ConfigEditor />, apiCall);
    await waitFor(() => expect(view.getByText("feature_flag")).toBeInTheDocument());
    return { ...view, apiCall };
  }

  it("asks for confirmation and does not remove on the first click", async () => {
    const { getByRole, getByText, apiCall } = await renderEditor();
    fireEvent.click(getByRole("button", { name: "Remove" }));
    expect(getByText("Remove feature_flag?")).toBeInTheDocument();
    expect(deleteCalls(apiCall)).toHaveLength(0);
  });

  it("removes the key after the confirmation", async () => {
    const { getByRole, apiCall } = await renderEditor();
    fireEvent.click(getByRole("button", { name: "Remove" }));
    fireEvent.click(getByRole("button", { name: "Yes, remove" }));
    await waitFor(() => expect(deleteCalls(apiCall)).toHaveLength(1));
    expect(deleteCalls(apiCall)[0][0]).toBe("/api/v1/tenants/tenant-1/config/feature_flag");
  });

  it("keeps the key and returns focus to Remove when the user selects Keep", async () => {
    const { getByRole, queryByText, apiCall } = await renderEditor();
    fireEvent.click(getByRole("button", { name: "Remove" }));
    const keep = getByRole("button", { name: "Keep" });
    expect(keep).toHaveFocus();
    fireEvent.click(keep);
    expect(queryByText("Remove feature_flag?")).toBeNull();
    expect(getByRole("button", { name: "Remove" })).toHaveFocus();
    expect(deleteCalls(apiCall)).toHaveLength(0);
  });

  it("cancels the confirmation on Escape", async () => {
    const { getByRole, queryByText, apiCall } = await renderEditor();
    fireEvent.click(getByRole("button", { name: "Remove" }));
    fireEvent.keyDown(getByRole("button", { name: "Keep" }), { key: "Escape" });
    expect(queryByText("Remove feature_flag?")).toBeNull();
    expect(deleteCalls(apiCall)).toHaveLength(0);
  });

  it("reports a failed remove in plain language and keeps the raw message as detail", async () => {
    const { getByRole, toast } = await renderEditor(true);
    fireEvent.click(getByRole("button", { name: "Remove" }));
    fireEvent.click(getByRole("button", { name: "Yes, remove" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    const [message, detail] = toast.error.mock.calls[0];
    expect(message).toBe('Could not remove "feature_flag". The key is unchanged.');
    expect(detail).toBe("connection reset by peer");
  });
});

describe("WebhookEditor delete", () => {
  async function renderEditor(failMutations = false) {
    const apiCall = makeApiCall(failMutations);
    const view = renderWith(<WebhookEditor />, apiCall);
    await waitFor(() => expect(view.getByText("https://example.com/hook")).toBeInTheDocument());
    return { ...view, apiCall };
  }

  it("asks for confirmation and does not delete on the first click", async () => {
    const { getByRole, getByText, apiCall } = await renderEditor();
    fireEvent.click(getByRole("button", { name: "Delete" }));
    expect(getByText("Delete this webhook?")).toBeInTheDocument();
    expect(deleteCalls(apiCall)).toHaveLength(0);
  });

  it("deletes the webhook after the confirmation", async () => {
    const { getByRole, apiCall } = await renderEditor();
    fireEvent.click(getByRole("button", { name: "Delete" }));
    fireEvent.click(getByRole("button", { name: "Yes, delete" }));
    await waitFor(() => expect(deleteCalls(apiCall)).toHaveLength(1));
    expect(deleteCalls(apiCall)[0][0]).toBe("/api/v1/webhooks/wh-1");
  });

  it("keeps the webhook when the user selects Keep", async () => {
    const { getByRole, container, apiCall } = await renderEditor();
    fireEvent.click(getByRole("button", { name: "Delete" }));
    fireEvent.click(getByRole("button", { name: "Keep" }));
    expect(within(container).getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(deleteCalls(apiCall)).toHaveLength(0);
  });

  it("reports a failed delete in plain language and keeps the raw message as detail", async () => {
    const { getByRole, toast } = await renderEditor(true);
    fireEvent.click(getByRole("button", { name: "Delete" }));
    fireEvent.click(getByRole("button", { name: "Yes, delete" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    const [message, detail] = toast.error.mock.calls[0];
    expect(message).toBe("Could not delete the webhook. It still receives events.");
    expect(detail).toBe("connection reset by peer");
  });
});
