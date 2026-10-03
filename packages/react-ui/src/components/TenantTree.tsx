import React from "react";
import { useTenantTree, type TenantTreeNode } from "../hooks/use-tenant-tree.js";
import { useTenant } from "../hooks/use-tenant.js";
import { useMessages } from "../hooks/use-messages.js";
import { useTreeKeyboard } from "../hooks/use-tree-keyboard.js";
import type { MessageKey } from "../i18n.js";

/** The badge text for each isolation strategy. `DraggableTenantTree` reads it too. */
export const isolationBadgeKey: Record<TenantTreeNode["isolation_strategy"], MessageKey> = {
  SHARED_RLS: "tenantTree.badgeRls",
  SCHEMA_PER_TENANT: "tenantTree.badgeSchema",
  DB_PER_TENANT: "tenantTree.badgeDatabase",
};

type ItemProps = ReturnType<typeof useTreeKeyboard>["itemProps"];

export interface TenantTreeProps {
  rootId?: string;
  onSelect?: (tenantId: string) => void;
  onEdit?: (tenantId: string, currentName: string) => void;
  onArchive?: (tenantId: string, name: string) => void;
  onAddChild?: (parentId: string) => void;
  className?: string;
}

function TreeNode({
  node,
  selectedId,
  onSelect,
  onToggle,
  onEdit,
  onArchive,
  onAddChild,
  depth,
  t,
  activeId,
  itemProps,
}: {
  node: TenantTreeNode;
  selectedId?: string;
  onSelect?: (id: string) => void;
  onToggle: (id: string) => void;
  onEdit?: (id: string, name: string) => void;
  onArchive?: (id: string, name: string) => void;
  onAddChild?: (parentId: string) => void;
  depth: number;
  t: (key: MessageKey, params?: Record<string, string>) => string;
  activeId: string | null;
  itemProps: ItemProps;
}) {
  const hasChildren = node.children.length > 0;
  // Row buttons join the tab order only in the active row, so Tab leaves the tree
  // after one row instead of after every row.
  const rowTabIndex = node.id === activeId ? 0 : -1;
  const name = { name: node.name };

  return (
    <li
      role="treeitem"
      aria-expanded={hasChildren ? node.expanded : undefined}
      aria-selected={selectedId === node.id}
      {...itemProps(node.id)}
    >
      <div
        className={`stratum-tree__node stratum-tree__node--d${Math.min(depth, 4)} ${selectedId === node.id ? "stratum-tree__node--selected" : ""}`}
        style={{ marginInlineStart: `calc(${depth} * var(--stratum-tree-indent, 28px))` }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="stratum-tree__toggle"
            tabIndex={-1}
            onClick={() => onToggle(node.id)}
            aria-label={node.expanded ? t("tenantTree.collapse") : t("tenantTree.expand")}
          >
            {node.expanded ? "\u25BC" : "\u25B6"}
          </button>
        ) : (
          <span className="stratum-tree__spacer">  </span>
        )}
        <span className="stratum-tree__label" title={node.name} onClick={() => onSelect?.(node.id)}>
          {node.name}
        </span>
        <span className="stratum-tree__badge">{t(isolationBadgeKey[node.isolation_strategy])}</span>
        <span className="stratum-tree__meta">
          {node.status === "archived" ? t("tenantTree.archived") : ""}
        </span>
        {(onEdit || onArchive || onAddChild) && (
          <span className="stratum-tree__actions">
            {onEdit && (
              <button
                type="button"
                className="stratum-tree__action-btn"
                tabIndex={rowTabIndex}
                onClick={(e) => { e.stopPropagation(); onEdit(node.id, node.name); }}
                aria-label={t("tenantTree.editTenant", name)}
                title={t("tenantTree.editTenant", name)}
              >
                {"\u270E"}
              </button>
            )}
            {onAddChild && (
              <button
                type="button"
                className="stratum-tree__action-btn"
                tabIndex={rowTabIndex}
                onClick={(e) => { e.stopPropagation(); onAddChild(node.id); }}
                aria-label={t("tenantTree.addChild", name)}
                title={t("tenantTree.addChild", name)}
              >
                +
              </button>
            )}
            {onArchive && !hasChildren && (
              <button
                type="button"
                className="stratum-tree__action-btn stratum-tree__action-btn--danger"
                tabIndex={rowTabIndex}
                onClick={(e) => { e.stopPropagation(); onArchive(node.id, node.name); }}
                aria-label={t("tenantTree.archiveTenant", name)}
                title={t("tenantTree.archiveTenant", name)}
              >
                &times;
              </button>
            )}
          </span>
        )}
      </div>
      {hasChildren && node.expanded && (
        <ul role="group">
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              selectedId={selectedId}
              onSelect={onSelect}
              onToggle={onToggle}
              onEdit={onEdit}
              onArchive={onArchive}
              onAddChild={onAddChild}
              depth={depth + 1}
              t={t}
              activeId={activeId}
              itemProps={itemProps}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function TenantTree({ rootId, onSelect, onEdit, onArchive, onAddChild, className }: TenantTreeProps) {
  const { tree, loading, error, toggleExpand } = useTenantTree(rootId);
  const { tenant } = useTenant();
  const { t } = useMessages();
  const { activeId, itemProps, rootProps } = useTreeKeyboard(tree, tenant?.id, onSelect, toggleExpand);

  if (loading) return <div className={className}>{t("tenantTree.loading")}</div>;
  if (error) return <div className={className}>{t("tenantTree.error", { message: error.message })}</div>;

  return (
    <div className={`stratum-tree ${className || ""}`}>
      <ul role="tree" {...rootProps}>
        {tree.map((node) => (
          <TreeNode
            key={node.id}
            node={node}
            selectedId={tenant?.id}
            onSelect={onSelect}
            onToggle={toggleExpand}
            onEdit={onEdit}
            onArchive={onArchive}
            onAddChild={onAddChild}
            depth={0}
            t={t}
            activeId={activeId}
            itemProps={itemProps}
          />
        ))}
      </ul>
    </div>
  );
}
