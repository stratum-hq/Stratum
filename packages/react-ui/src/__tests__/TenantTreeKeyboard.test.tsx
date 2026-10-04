import React from "react";
import { render, within, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import type { TenantNode } from "@stratum-hq/core";
import { StratumContext, type StratumContextValue } from "../provider.js";
import { TenantTree } from "../components/TenantTree.js";
import { DraggableTenantTree } from "../components/DraggableTenantTree.js";

// Both trees implement the same WAI-ARIA tree pattern, so one suite runs on each.

afterEach(() => {
  cleanup();
});

function tenant(
  id: string,
  name: string,
  parentId: string | null,
  strategy: TenantNode["isolation_strategy"],
): TenantNode {
  return {
    id,
    name,
    slug: id,
    status: "active",
    parent_id: parentId,
    ancestry_path: parentId ? `${parentId}.${id}` : id,
    depth: parentId ? 1 : 0,
    isolation_strategy: strategy,
    config: {},
    metadata: {},
    sort_order: 0,
    deleted_at: null,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  } as TenantNode;
}

const tenants = [
  tenant("acme", "Acme Corp", null, "SHARED_RLS"),
  tenant("ios", "iOS Team", "acme", "SCHEMA_PER_TENANT"),
  tenant("bank", "First Bank", "acme", "DB_PER_TENANT"),
  tenant("globex", "Globex", null, "SHARED_RLS"),
];

function contextValue(): StratumContextValue {
  return {
    currentTenant: null,
    tenantContext: null,
    loading: false,
    error: null,
    switchTenant: vi.fn().mockResolvedValue(undefined),
    apiCall: vi.fn().mockResolvedValue({ data: tenants }),
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  } as StratumContextValue;
}

type TreeProps = {
  onSelect?: (id: string) => void;
  onEdit?: (id: string, name: string) => void;
  onAddChild?: (id: string) => void;
  onArchive?: (id: string, name: string) => void;
};

const trees: Array<[string, (props: TreeProps) => React.ReactElement]> = [
  ["TenantTree", (props) => <TenantTree {...props} />],
  ["DraggableTenantTree", (props) => <DraggableTenantTree {...props} />],
];

describe.each(trees)("%s", (_name, makeTree) => {
  async function renderTree(props: TreeProps = {}) {
    const result = render(
      <StratumContext.Provider value={contextValue()}>{makeTree(props)}</StratumContext.Provider>,
    );
    const tree = await waitFor(() => within(result.container).getByRole("tree"));
    return { ...result, tree };
  }

  function item(tree: HTMLElement, name: string): HTMLElement {
    const label = within(tree).getByText(name);
    const li = label.closest('[role="treeitem"]');
    if (!li) throw new Error(`no treeitem for ${name}`);
    return li as HTMLElement;
  }

  function press(key: string) {
    fireEvent.keyDown(document.activeElement as Element, { key });
  }

  function focus(el: HTMLElement) {
    act(() => el.focus());
  }

  it("shows the isolation strategy of each tenant on its badge", async () => {
    const { tree } = await renderTree();
    focus(item(tree, "Acme Corp"));
    press("ArrowRight");

    const badge = (name: string) =>
      item(tree, name).querySelector(":scope > .stratum-tree__node .stratum-tree__badge")?.textContent;
    expect(badge("Acme Corp")).toBe("RLS");
    expect(badge("iOS Team")).toBe("Schema");
    expect(badge("First Bank")).toBe("Database");
  });

  it("gives exactly one tree item a tab stop", async () => {
    const { tree } = await renderTree();
    const stops = within(tree).getAllByRole("treeitem").filter((el) => el.tabIndex === 0);
    expect(stops).toEqual([item(tree, "Acme Corp")]);
  });

  it("moves focus with ArrowDown, ArrowUp, Home and End", async () => {
    const { tree } = await renderTree();
    focus(item(tree, "Acme Corp"));

    press("ArrowDown");
    expect(document.activeElement).toBe(item(tree, "Globex"));
    press("ArrowUp");
    expect(document.activeElement).toBe(item(tree, "Acme Corp"));
    press("End");
    expect(document.activeElement).toBe(item(tree, "Globex"));
    press("Home");
    expect(document.activeElement).toBe(item(tree, "Acme Corp"));
  });

  it("moves the tab stop with the focus", async () => {
    const { tree } = await renderTree();
    focus(item(tree, "Acme Corp"));
    press("ArrowDown");

    expect(item(tree, "Globex").tabIndex).toBe(0);
    expect(item(tree, "Acme Corp").tabIndex).toBe(-1);
  });

  it("expands a collapsed tenant with ArrowRight, then moves to its first child", async () => {
    const { tree } = await renderTree();
    focus(item(tree, "Acme Corp"));

    press("ArrowRight");
    expect(item(tree, "Acme Corp")).toHaveAttribute("aria-expanded", "true");
    expect(document.activeElement).toBe(item(tree, "Acme Corp"));
    press("ArrowRight");
    expect(document.activeElement).toBe(item(tree, "iOS Team"));
  });

  it("moves to the parent with ArrowLeft, then collapses it", async () => {
    const { tree } = await renderTree();
    focus(item(tree, "Acme Corp"));
    press("ArrowRight");
    press("ArrowRight");

    press("ArrowLeft");
    expect(document.activeElement).toBe(item(tree, "Acme Corp"));
    press("ArrowLeft");
    expect(item(tree, "Acme Corp")).toHaveAttribute("aria-expanded", "false");
  });

  it("selects the focused tenant with Enter", async () => {
    const onSelect = vi.fn();
    const { tree } = await renderTree({ onSelect });
    focus(item(tree, "Acme Corp"));
    press("ArrowDown");
    press("Enter");

    expect(onSelect).toHaveBeenCalledWith("globex");
  });

  it("shows the full name of a tenant in the label title, in its own case", async () => {
    const { tree } = await renderTree();
    focus(item(tree, "Acme Corp"));
    press("ArrowRight");

    expect(within(tree).getByText("iOS Team")).toHaveAttribute("title", "iOS Team");
  });

  it("names each action button after its action and the tenant", async () => {
    const { tree } = await renderTree({ onEdit: vi.fn(), onAddChild: vi.fn(), onArchive: vi.fn() });
    const globex = item(tree, "Globex");

    expect(within(globex).getByRole("button", { name: "Edit Globex" })).toBeInTheDocument();
    expect(within(globex).getByRole("button", { name: "Add a child tenant to Globex" })).toBeInTheDocument();
    expect(within(globex).getByRole("button", { name: "Archive Globex" })).toBeInTheDocument();
  });

  it("puts the row buttons in the tab order of the active row only", async () => {
    const { tree } = await renderTree({ onEdit: vi.fn() });
    const editAcme = within(item(tree, "Acme Corp")).getByRole("button", { name: "Edit Acme Corp" });
    const editGlobex = within(item(tree, "Globex")).getByRole("button", { name: "Edit Globex" });

    expect(editAcme.tabIndex).toBe(0);
    expect(editGlobex.tabIndex).toBe(-1);
    // The arrow keys expand and collapse, so the toggle stays out of the tab order.
    expect(within(tree).getByRole("button", { name: "Expand" }).tabIndex).toBe(-1);
  });

  it("stops the settle animation after the first one ends", async () => {
    const { tree } = await renderTree();
    expect(tree).not.toHaveClass("stratum-tree__root--settled");

    const row = item(tree, "Acme Corp").querySelector(".stratum-tree__node") as HTMLElement;
    fireEvent.animationEnd(row);
    expect(tree).toHaveClass("stratum-tree__root--settled");
  });
});
