import { useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import type { TenantTreeNode } from "./use-tenant-tree.js";

interface VisibleItem {
  node: TenantTreeNode;
  parentId: string | null;
}

/** Returns the rows a user can see, in display order: a collapsed tenant hides its children. */
function visibleItems(nodes: TenantTreeNode[], parentId: string | null, out: VisibleItem[] = []): VisibleItem[] {
  for (const node of nodes) {
    out.push({ node, parentId });
    if (node.expanded) visibleItems(node.children, node.id, out);
  }
  return out;
}

function treeItemId(target: EventTarget): string | null {
  const el = target as HTMLElement;
  return el.getAttribute("role") === "treeitem" ? el.dataset.tenantId ?? null : null;
}

/**
 * Return the props that implement the WAI-ARIA tree pattern with a roving tabindex.
 *
 * Only one tree item is in the tab order at a time. The arrow keys, Home and End move
 * the focus, ArrowRight and ArrowLeft expand and collapse, and Enter selects.
 *
 * @param tree - The tenant tree from `useTenantTree`.
 * @param selectedId - The selected tenant. It holds the tab stop until the user moves the focus.
 * @param onSelect - Receives the tenant id when the user presses Enter.
 * @param onToggle - Expands or collapses a tenant.
 */
export function useTreeKeyboard(
  tree: TenantTreeNode[],
  selectedId: string | undefined,
  onSelect: ((id: string) => void) | undefined,
  onToggle: (id: string) => void,
) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [settled, setSettled] = useState(false);
  const itemEls = useRef(new Map<string, HTMLElement>());
  const items = useMemo(() => visibleItems(tree, null), [tree]);

  // A collapse can hide the focused tenant. The tab stop then falls back, so the tree
  // always keeps exactly one.
  const isVisible = (id: string | null | undefined) => !!id && items.some((i) => i.node.id === id);
  const activeId = isVisible(focusedId)
    ? focusedId
    : isVisible(selectedId)
      ? (selectedId as string)
      : (items[0]?.node.id ?? null);

  const moveFocus = (id: string) => {
    setFocusedId(id);
    itemEls.current.get(id)?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    // Keys on a button inside a row belong to that button.
    const id = treeItemId(e.target);
    if (!id) return;
    const index = items.findIndex((i) => i.node.id === id);
    const { node, parentId } = items[index];
    const hasChildren = node.children.length > 0;
    let next: VisibleItem | undefined;

    switch (e.key) {
      case "ArrowDown":
        next = items[index + 1];
        break;
      case "ArrowUp":
        next = items[index - 1];
        break;
      case "Home":
        next = items[0];
        break;
      case "End":
        next = items[items.length - 1];
        break;
      case "ArrowRight":
        if (hasChildren && !node.expanded) onToggle(id);
        else if (hasChildren) next = items[index + 1];
        break;
      case "ArrowLeft":
        if (hasChildren && node.expanded) onToggle(id);
        else if (parentId) next = items.find((i) => i.node.id === parentId);
        break;
      case "Enter":
        onSelect?.(id);
        break;
      default:
        return;
    }
    e.preventDefault();
    if (next) moveFocus(next.node.id);
  };

  // A click on a row focuses its tree item, so the tab stop follows the mouse too.
  const onFocus = (e: FocusEvent<HTMLElement>) => {
    const id = treeItemId(e.target);
    if (id) setFocusedId(id);
  };

  // The first-mount settle animation must not run again for rows that an expand adds.
  const onAnimationEnd = () => setSettled(true);

  const itemProps = (id: string) => ({
    ref: (el: HTMLElement | null) => {
      if (el) itemEls.current.set(id, el);
      else itemEls.current.delete(id);
    },
    tabIndex: id === activeId ? 0 : -1,
    "data-tenant-id": id,
  });

  return {
    activeId,
    itemProps,
    rootProps: {
      className: settled ? "stratum-tree__root stratum-tree__root--settled" : "stratum-tree__root",
      onKeyDown,
      onFocus,
      onAnimationEnd,
    },
  };
}
