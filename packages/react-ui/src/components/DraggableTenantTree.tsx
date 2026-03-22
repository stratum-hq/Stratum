/**
 * DraggableTenantTree — TenantTree with drag-and-drop reparenting.
 *
 * Drag a tenant node onto another to move it as a child of the drop target.
 * Uses @dnd-kit/core for drag interactions. Calls the Stratum moveTenant API
 * on drop. Shows visual drop indicators during drag.
 *
 * ┌──────────────────────────────────┐
 * │  AcmeSec                         │
 * │  ├── NorthStar MSP               │
 * │  │   ├── Client Alpha   ← drag  │
 * │  │   └── Client Beta            │
 * │  └── SouthShield MSP   ← drop   │  ← "Move Client Alpha under SouthShield?"
 * │      └── Client Gamma           │
 * └──────────────────────────────────┘
 */

import React, { useState, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  closestCenter,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useTenantTree, type TenantTreeNode } from "../hooks/use-tenant-tree.js";
import { useTenant } from "../hooks/use-tenant.js";
import { useStratum } from "../provider.js";
import { useMessages } from "../hooks/use-messages.js";
import type { MessageKey } from "../i18n.js";

export interface DraggableTenantTreeProps {
  rootId?: string;
  onSelect?: (tenantId: string) => void;
  onMove?: (tenantId: string, newParentId: string) => void;
  className?: string;
}

// ── Draggable + Droppable node ──────────────────────────────

function DraggableTreeNode({
  node,
  selectedId,
  onSelect,
  onToggle,
  depth,
  t,
}: {
  node: TenantTreeNode;
  selectedId?: string;
  onSelect?: (id: string) => void;
  onToggle: (id: string) => void;
  depth: number;
  t: (key: MessageKey, params?: Record<string, string>) => string;
}) {
  const hasChildren = node.children.length > 0;

  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: node.id,
    data: { node },
  });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `drop-${node.id}`,
    data: { node },
  });

  return (
    <li role="treeitem" aria-expanded={hasChildren ? node.expanded : undefined}>
      <div
        ref={(el) => { setDragRef(el); setDropRef(el); }}
        className={[
          "stratum-tree__node",
          selectedId === node.id ? "stratum-tree__node--selected" : "",
          isDragging ? "stratum-tree__node--dragging" : "",
          isOver ? "stratum-tree__node--drop-target" : "",
        ].filter(Boolean).join(" ")}
        style={{
          paddingInlineStart: `calc(${depth} * var(--space-xl) + var(--space-sm))`,
          opacity: isDragging ? 0.4 : 1,
        }}
        {...attributes}
        {...listeners}
      >
        {hasChildren ? (
          <button
            type="button"
            className="stratum-tree__toggle"
            onClick={(e) => { e.stopPropagation(); onToggle(node.id); }}
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
      </div>
      {hasChildren && node.expanded && (
        <ul role="group">
          {node.children.map((child) => (
            <DraggableTreeNode
              key={child.id}
              node={child}
              selectedId={selectedId}
              onSelect={onSelect}
              onToggle={onToggle}
              depth={depth + 1}
              t={t}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

// ── Drag overlay (ghost element shown while dragging) ────────

function DragOverlayContent({ node }: { node: TenantTreeNode }) {
  return (
    <div className="stratum-tree__drag-overlay">
      {node.name}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────

export function DraggableTenantTree({
  rootId,
  onSelect,
  onMove,
  className,
}: DraggableTenantTreeProps) {
  const { tree, loading, error, toggleExpand, refresh } = useTenantTree(rootId);
  const { tenant } = useTenant();
  const { apiCall, toast } = useStratum();
  const { t } = useMessages();
  const [activeNode, setActiveNode] = useState<TenantTreeNode | null>(null);

  // Find a node by ID in the tree
  const findNode = useCallback(
    (id: string, nodes: TenantTreeNode[] = tree): TenantTreeNode | null => {
      for (const node of nodes) {
        if (node.id === id) return node;
        const found = findNode(id, node.children);
        if (found) return found;
      }
      return null;
    },
    [tree],
  );

  const handleDragStart = (event: DragStartEvent) => {
    const node = event.active.data.current?.node as TenantTreeNode | undefined;
    setActiveNode(node ?? null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveNode(null);
    const { active, over } = event;
    if (!over) return;

    const draggedId = active.id as string;
    // Drop target IDs are prefixed with "drop-"
    const targetId = (over.id as string).replace(/^drop-/, "");

    // Don't drop on self or current parent
    if (draggedId === targetId) return;
    const draggedNode = findNode(draggedId);
    if (!draggedNode) return;

    // Check: don't drop a parent onto its own descendant (cycle)
    const isDescendant = (parentNode: TenantTreeNode, childId: string): boolean => {
      for (const child of parentNode.children) {
        if (child.id === childId) return true;
        if (isDescendant(child, childId)) return true;
      }
      return false;
    };

    if (isDescendant(draggedNode, targetId)) {
      toast.error("Cannot move a tenant under its own descendant");
      return;
    }

    try {
      await apiCall(`/api/v1/tenants/${draggedId}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_parent_id: targetId }),
      });
      toast.success(`Moved "${draggedNode.name}" successfully`);
      onMove?.(draggedId, targetId);
      await refresh();
    } catch (err) {
      toast.error(
        `Failed to move tenant: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  if (loading) return <div className={className}>{t("tenantTree.loading")}</div>;
  if (error) return <div className={className}>{t("tenantTree.error", { message: error.message })}</div>;

  return (
    <div className={`stratum-tree stratum-tree--draggable ${className || ""}`}>
      <style>{draggableStyles}</style>
      <DndContext
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <ul role="tree" className="stratum-tree__root">
          {tree.map((node) => (
            <DraggableTreeNode
              key={node.id}
              node={node}
              selectedId={tenant?.id}
              onSelect={onSelect}
              onToggle={toggleExpand}
              depth={0}
              t={t}
            />
          ))}
        </ul>

        <DragOverlay>
          {activeNode ? <DragOverlayContent node={activeNode} /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

// ── Scoped styles ───────────────────────────────────────────

const draggableStyles = `
.stratum-tree__node--dragging {
  opacity: 0.4;
}

.stratum-tree__node--drop-target {
  outline: 2px dashed var(--color-accent, #0D9488);
  outline-offset: -2px;
  border-radius: var(--radius-sm, 4px);
  background: rgba(13, 148, 136, 0.08);
}

.stratum-tree__drag-overlay {
  padding: var(--space-xs, 4px) var(--space-md, 12px);
  background: var(--bg-card, white);
  border: 1px solid var(--color-accent, #0D9488);
  border-radius: var(--radius-sm, 4px);
  box-shadow: var(--shadow-md);
  font-size: 0.8125rem;
  font-family: var(--font-body, 'DM Sans', system-ui, sans-serif);
  color: var(--text-primary, #0F172A);
  cursor: grabbing;
}

.stratum-tree--draggable .stratum-tree__node {
  cursor: grab;
}

.stratum-tree--draggable .stratum-tree__node:active {
  cursor: grabbing;
}
`;
