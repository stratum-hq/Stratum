import React from "react";
import { useTenantTree, type TenantTreeNode } from "../hooks/use-tenant-tree.js";
import { useTenant } from "../hooks/use-tenant.js";
import { useMessages } from "../hooks/use-messages.js";
import type { MessageKey } from "../i18n.js";

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
}) {
  const hasChildren = node.children.length > 0;

  return (
    <li role="treeitem" aria-expanded={hasChildren ? node.expanded : undefined}>
      <div
        className={`stratum-tree__node ${selectedId === node.id ? "stratum-tree__node--selected" : ""}`}
        style={{ paddingInlineStart: `calc(${depth} * var(--space-xl) + var(--space-sm))` }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="stratum-tree__toggle"
            onClick={() => onToggle(node.id)}
            aria-label={node.expanded ? t("tenantTree.collapse") : t("tenantTree.expand")}
          >
            {node.expanded ? "\u25BC" : "\u25B6"}
          </button>
        ) : (
          <span className="stratum-tree__spacer">  </span>
        )}
        <span
          className="stratum-tree__label"
          onClick={() => onSelect?.(node.id)}
          onKeyDown={(e) => e.key === "Enter" && onSelect?.(node.id)}
          tabIndex={0}
          role="button"
        >
          {node.name}
        </span>
        <span className="stratum-tree__badge">{t("tenantTree.badgeRls")}</span>
        <span className="stratum-tree__meta">
          {node.status === "archived" ? t("tenantTree.archived") : ""}
        </span>
        {(onEdit || onArchive || onAddChild) && (
          <span className="stratum-tree__actions">
            {onEdit && (
              <button
                type="button"
                className="stratum-tree__action-btn"
                onClick={(e) => { e.stopPropagation(); onEdit(node.id, node.name); }}
                title="Edit tenant"
              >
                &#9998;
              </button>
            )}
            {onAddChild && (
              <button
                type="button"
                className="stratum-tree__action-btn"
                onClick={(e) => { e.stopPropagation(); onAddChild(node.id); }}
                title="Add child tenant"
              >
                +
              </button>
            )}
            {onArchive && !hasChildren && (
              <button
                type="button"
                className="stratum-tree__action-btn stratum-tree__action-btn--danger"
                onClick={(e) => { e.stopPropagation(); onArchive(node.id, node.name); }}
                title="Archive tenant"
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

  if (loading) return <div className={className}>{t("tenantTree.loading")}</div>;
  if (error) return <div className={className}>{t("tenantTree.error", { message: error.message })}</div>;

  return (
    <div className={`stratum-tree ${className || ""}`}>
      <ul role="tree" className="stratum-tree__root">
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
          />
        ))}
      </ul>
    </div>
  );
}
