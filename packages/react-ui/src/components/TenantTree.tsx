import React from "react";
import { useTenantTree, type TenantTreeNode } from "../hooks/use-tenant-tree.js";
import { useTenant } from "../hooks/use-tenant.js";

export interface TenantTreeProps {
  rootId?: string;
  onSelect?: (tenantId: string) => void;
  className?: string;
}

function TreeNode({
  node,
  selectedId,
  onSelect,
  onToggle,
  depth,
}: {
  node: TenantTreeNode;
  selectedId?: string;
  onSelect?: (id: string) => void;
  onToggle: (id: string) => void;
  depth: number;
}) {
  const hasChildren = node.children.length > 0;

  return (
    <li role="treeitem" aria-expanded={hasChildren ? node.expanded : undefined}>
      <div
        className={`stratum-tree__node ${selectedId === node.id ? "stratum-tree__node--selected" : ""}`}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="stratum-tree__toggle"
            onClick={() => onToggle(node.id)}
            aria-label={node.expanded ? "Collapse" : "Expand"}
          >
            {node.expanded ? "▼" : "▶"}
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
        <span className="stratum-tree__badge">RLS</span>
        <span className="stratum-tree__meta">
          {node.status === "archived" ? " (archived)" : ""}
        </span>
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
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function TenantTree({ rootId, onSelect, className }: TenantTreeProps) {
  const { tree, loading, error, toggleExpand } = useTenantTree(rootId);
  const { tenant } = useTenant();

  if (loading) return <div className={className}>Loading tree...</div>;
  if (error) return <div className={className}>Error: {error.message}</div>;

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
            depth={0}
          />
        ))}
      </ul>
    </div>
  );
}
