import React, { useState, useMemo } from "react";
import type { TenantNode } from "@stratum-hq/core";
import { useTenantTree } from "../hooks/use-tenant-tree.js";
import { useTenant } from "../hooks/use-tenant.js";
import { useMessages } from "../hooks/use-messages.js";

export interface TenantSwitcherProps {
  rootId?: string;
  onTenantChange?: (tenantId: string) => void;
  className?: string;
}

export function TenantSwitcher({ rootId, onTenantChange, className }: TenantSwitcherProps) {
  const { tree, loading } = useTenantTree(rootId);
  const { tenant, switchTenant } = useTenant();
  const { t } = useMessages();
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");

  const flattenTree = useMemo(() => {
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
    if (!search) return flattenTree;
    const lower = search.toLowerCase();
    return flattenTree.filter(
      ({ node }) =>
        node.name.toLowerCase().includes(lower) ||
        node.slug.toLowerCase().includes(lower),
    );
  }, [flattenTree, search]);

  const handleSelect = async (tenantId: string) => {
    await switchTenant(tenantId);
    onTenantChange?.(tenantId);
    setIsOpen(false);
    setSearch("");
  };

  if (loading) return <div className={className}>{t("tenantSwitcher.loading")}</div>;

  return (
    <div className={`stratum-tenant-switcher ${className || ""}`}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="stratum-tenant-switcher__trigger"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        {tenant ? tenant.name : t("tenantSwitcher.placeholder")}
        <span aria-hidden="true"> &#9662;</span>
      </button>

      {isOpen && (
        <div className="stratum-tenant-switcher__dropdown" role="listbox">
          <input
            type="text"
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
            placeholder={t("tenantSwitcher.searchPlaceholder")}
            className="stratum-tenant-switcher__search"
            aria-label={t("tenantSwitcher.searchLabel")}
          />
          <ul className="stratum-tenant-switcher__list">
            {filtered.map(({ node, depth }) => (
              <li
                key={node.id}
                role="option"
                aria-selected={tenant?.id === node.id}
                className={`stratum-tenant-switcher__item ${tenant?.id === node.id ? "stratum-tenant-switcher__item--active" : ""}`}
                style={{ paddingInlineStart: `calc(${depth} * var(--space-lg) + var(--space-sm))` }}
                onClick={() => handleSelect(node.id)}
                onKeyDown={(e) => e.key === "Enter" && handleSelect(node.id)}
                tabIndex={0}
              >
                {node.name}
                <span className="stratum-tenant-switcher__slug"> ({node.slug})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
