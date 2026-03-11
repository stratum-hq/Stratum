import { useState, useMemo } from "react";
import type { TenantNode } from "@stratum/core";
import { useTenantTree } from "../../hooks/use-tenant-tree.js";
import { useTenant } from "../../hooks/use-tenant.js";

export interface HeadlessTenantSwitcherProps {
  rootId?: string;
  onTenantChange?: (tenantId: string) => void;
  children: (api: HeadlessTenantSwitcherAPI) => React.ReactNode;
}

export interface HeadlessTenantSwitcherAPI {
  isOpen: boolean;
  toggle: () => void;
  open: () => void;
  close: () => void;
  search: string;
  setSearch: (value: string) => void;
  items: { node: TenantNode; depth: number }[];
  selectedId: string | null;
  select: (tenantId: string) => Promise<void>;
  loading: boolean;
  triggerProps: {
    onClick: () => void;
    "aria-haspopup": "listbox";
    "aria-expanded": boolean;
  };
  listProps: {
    role: "listbox";
  };
  getItemProps: (tenantId: string) => {
    role: "option";
    "aria-selected": boolean;
    onClick: () => void;
    onKeyDown: (e: React.KeyboardEvent) => void;
    tabIndex: number;
  };
}

export function HeadlessTenantSwitcher({
  rootId,
  onTenantChange,
  children,
}: HeadlessTenantSwitcherProps) {
  const { tree, loading } = useTenantTree(rootId);
  const { tenant, switchTenant } = useTenant();
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");

  const flatItems = useMemo(() => {
    const result: { node: TenantNode; depth: number }[] = [];
    function walk(nodes: typeof tree, depth: number) {
      for (const node of nodes) {
        result.push({ node, depth });
        walk(node.children, depth + 1);
      }
    }
    walk(tree, 0);
    return result;
  }, [tree]);

  const filtered = useMemo(() => {
    if (!search) return flatItems;
    const lower = search.toLowerCase();
    return flatItems.filter(
      ({ node }) =>
        node.name.toLowerCase().includes(lower) ||
        node.slug.toLowerCase().includes(lower),
    );
  }, [flatItems, search]);

  const select = async (tenantId: string) => {
    await switchTenant(tenantId);
    onTenantChange?.(tenantId);
    setIsOpen(false);
    setSearch("");
  };

  const api: HeadlessTenantSwitcherAPI = {
    isOpen,
    toggle: () => setIsOpen(!isOpen),
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    search,
    setSearch,
    items: filtered,
    selectedId: tenant?.id || null,
    select,
    loading,
    triggerProps: {
      onClick: () => setIsOpen(!isOpen),
      "aria-haspopup": "listbox",
      "aria-expanded": isOpen,
    },
    listProps: { role: "listbox" },
    getItemProps: (tenantId: string) => ({
      role: "option" as const,
      "aria-selected": tenant?.id === tenantId,
      onClick: () => select(tenantId),
      onKeyDown: (e: React.KeyboardEvent) => e.key === "Enter" && select(tenantId),
      tabIndex: 0,
    }),
  };

  return <>{children(api)}</>;
}
