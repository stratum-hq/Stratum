import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { StratumProvider } from "@stratum-hq/react";
import { Dashboard } from "./Dashboard.js";
import { installApiMock, MSP_ID, ACTIVE_KEY_ID, type RecordedCall } from "../test-api.js";

let calls: RecordedCall[];

function renderDashboard() {
  return render(
    <StratumProvider controlPlaneUrl="" initialTenantId={MSP_ID}>
      <Dashboard />
    </StratumProvider>,
  );
}

const deletes = () => calls.filter((c) => c.method === "DELETE");

describe("Dashboard", () => {
  beforeEach(() => {
    calls = installApiMock();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("counts the Overview figures without mounting the other sections", async () => {
    const { container } = renderDashboard();
    // 3 config keys in the fake API: 2 inherited, 1 locked.
    expect(await screen.findByText("2 inherited, 1 locked")).toBeInTheDocument();

    expect(container.querySelector(".stratum-config-editor")).toBeNull();
    expect(container.querySelector(".stratum-permission-editor")).toBeNull();
    expect(container.querySelector(".stratum-webhook-editor")).toBeNull();
    // Only the tenant context table is on the page.
    expect(container.querySelectorAll("table")).toHaveLength(1);
  });

  it("asks before it revokes an API key and names the key", async () => {
    renderDashboard();
    fireEvent.click(await screen.findByRole("tab", { name: "API keys" }));

    const row = (await screen.findByText("siem-ingest")).closest("tr");
    if (!row) throw new Error("API key row not rendered");
    fireEvent.click(within(row).getByRole("button", { name: "Revoke" }));

    expect(within(row).getByText(/siem-ingest/, { selector: ".demo-confirm__prompt" })).toBeInTheDocument();
    expect(within(row).getByText(/9f3c2a71/, { selector: ".demo-confirm__prompt" })).toBeInTheDocument();
    expect(deletes()).toHaveLength(0);

    fireEvent.click(within(row).getByRole("button", { name: "Keep key" }));
    expect(deletes()).toHaveLength(0);
    const revoke = within(row).getByRole("button", { name: "Revoke" });
    expect(revoke).toHaveFocus();

    fireEvent.click(revoke);
    fireEvent.click(within(row).getByRole("button", { name: "Revoke key" }));
    await vi.waitFor(() => expect(deletes()).toEqual([{ method: "DELETE", path: `/api/v1/api-keys/${ACTIVE_KEY_ID}` }]));
  });

  it("closes the resolved context dialog on Escape and returns focus to its button", async () => {
    renderDashboard();
    const open = await screen.findByRole("button", { name: "Resolved context" });
    fireEvent.click(open);

    const dialog = await screen.findByRole("dialog", { name: "Resolved context" });
    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(open).toHaveFocus();
  });

  it("shows tab names without icon glyphs", async () => {
    renderDashboard();
    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Overview",
      "Config",
      "Permissions",
      "Events",
      "Audit",
      "API keys",
      "Webhooks",
    ]);
  });
});
