import React from "react";
import { render, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

// The components get their styles from the package stylesheet. A <style> tag
// rendered at runtime would bypass the stratum cascade layer and the host's CSP.

const tree = [
  {
    id: "t1",
    name: "Root",
    slug: "root",
    status: "active",
    parent_id: null,
    ancestry_path: "t1",
    depth: 0,
    isolation_strategy: "SHARED_RLS",
    config: {},
    metadata: {},
    sort_order: 0,
    deleted_at: null,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    children: [],
    expanded: false,
  },
];

vi.mock("../hooks/use-tenant-tree.js", () => ({
  useTenantTree: () => ({ tree, loading: false, error: null, toggleExpand: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("../hooks/use-tenant.js", () => ({ useTenant: () => ({ tenant: null }) }));
vi.mock("../hooks/use-messages.js", () => ({ useMessages: () => ({ t: (key: string) => key }) }));
vi.mock("../provider.js", () => ({
  useStratum: () => ({ apiCall: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }),
}));
vi.mock("../hooks/use-config-cascade.js", () => ({
  useConfigCascade: () => ({
    data: {
      parent: { id: "p", name: "Parent", slug: "parent", config: [] },
      children: [{ id: "c", name: "Child", slug: "child", config: [] }],
    },
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

import { DraggableTenantTree } from "../components/DraggableTenantTree.js";
import { ConfigInheritanceVisualizer } from "../components/ConfigInheritanceVisualizer.js";
import { TenantThemeProvider } from "../components/TenantThemeProvider.js";

afterEach(() => cleanup());

describe("runtime styles", () => {
  it("DraggableTenantTree renders no style element", () => {
    const { container } = render(<DraggableTenantTree />);
    expect(container.querySelector(".stratum-tree")).not.toBeNull();
    expect(container.querySelectorAll("style")).toHaveLength(0);
  });

  it("ConfigInheritanceVisualizer renders no style element", () => {
    const { container } = render(<ConfigInheritanceVisualizer />);
    expect(container.querySelector(".stratum-cascade-split")).not.toBeNull();
    expect(container.querySelectorAll("style")).toHaveLength(0);
  });
});

describe("TenantThemeProvider", () => {
  it("sets primaryColor as the --stratum-accent token", () => {
    const { container } = render(
      <TenantThemeProvider branding={{ primaryColor: "#0055aa" }}>
        <span />
      </TenantThemeProvider>,
    );
    const scope = container.querySelector(".stratum-tenant-theme-provider") as HTMLElement;
    expect(scope.style.getPropertyValue("--stratum-accent")).toBe("#0055aa");
    expect(scope.style.getPropertyValue("--color-primary")).toBe("");
  });
});
