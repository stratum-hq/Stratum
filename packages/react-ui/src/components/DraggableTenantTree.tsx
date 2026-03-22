/**
 * DraggableTenantTree — TenantTree with drag-and-drop support.
 *
 * Supports two operations:
 * - **Reparenting**: drag a tenant onto a different parent → calls moveTenant API
 * - **Sibling reordering**: drag a tenant above/below a sibling → calls reorderTenant API
 *
 * Uses a dedicated drag handle (⠿) so clicking the node still selects it
 * and clicking the expand/collapse arrow still works.
 *
 * ┌──────────────────────────────────┐
 * │  ⠿ AcmeSec                      │
 * │  ⠿ ├── NorthStar MSP            │
 * │  ⠿ │   ├── Client Alpha  ← drag │
 * │  ⠿ │   └── Client Beta          │
 * │  ⠿ └── SouthShield MSP  ← drop  │
 * │  ⠿     └── Client Gamma         │
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
  onReorder?: (tenantId: string, position: number) => void;
  onEdit?: (tenantId: string, currentName: string) => void;
  onArchive?: (tenantId: string, name: string) => void;
  onAddChild?: (parentId: string) => void;
  className?: string;
}

// ── Draggable + Droppable node ──────────────────────────────

function DraggableTreeNode({
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
        ref={setDropRef}
        className={[
          "stratum-tree__node",
          selectedId === node.id ? "stratum-tree__node--selected" : "",
          isDragging ? "stratum-tree__node--dragging" : "",
          isOver ? "stratum-tree__node--drop-target" : "",
        ].filter(Boolean).join(" ")}
        style={{
          paddingInlineStart: `calc(${depth} * var(--space-xl, 24px) + var(--space-sm, 8px))`,
          opacity: isDragging ? 0.4 : 1,
        }}
      >
        {/* Drag handle — only this initiates drag */}
        <span
          ref={setDragRef}
          {...attributes}
          {...listeners}
          className="stratum-tree__drag-handle"
          title="Drag to reparent or reorder"
          onClick={(e) => e.stopPropagation()}
        >
          ⠿
        </span>

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

        {/* CRUD actions */}
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
            <DraggableTreeNode
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

// ── Main component ──────────────────────────────────────────

export function DraggableTenantTree({
  rootId,
  onSelect,
  onMove,
  onReorder,
  onEdit,
  onArchive,
  onAddChild,
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

  // Find siblings of a node (nodes with same parent_id)
  const findSiblings = useCallback(
    (parentId: string | null, nodes: TenantTreeNode[] = tree): TenantTreeNode[] => {
      if (!parentId) return tree; // root-level siblings
      const parent = findNode(parentId);
      return parent ? parent.children : [];
    },
    [tree, findNode],
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
    const targetId = (over.id as string).replace(/^drop-/, "");

    if (draggedId === targetId) return;

    const draggedNode = findNode(draggedId);
    const targetNode = findNode(targetId);
    if (!draggedNode || !targetNode) return;

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

    // Determine operation: reorder (same parent) or reparent (different parent)
    const sameParent = draggedNode.parent_id === targetNode.parent_id;

    try {
      if (sameParent) {
        // Sibling reorder — find target's position and place dragged there
        const siblings = findSiblings(targetNode.parent_id);
        const targetIndex = siblings.findIndex((s) => s.id === targetId);
        const position = Math.max(0, targetIndex);

        await apiCall(`/api/v1/tenants/${draggedId}/reorder`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ position }),
        });
        toast.success(`Reordered "${draggedNode.name}"`);
        onReorder?.(draggedId, position);
      } else {
        // Reparent — move to target as new parent
        await apiCall(`/api/v1/tenants/${draggedId}/move`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ new_parent_id: targetId }),
        });
        toast.success(`Moved "${draggedNode.name}" under "${targetNode.name}"`);
        onMove?.(draggedId, targetId);
      }

      await refresh();
    } catch (err) {
      toast.error(
        `Failed: ${err instanceof Error ? err.message : String(err)}`,
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
              onEdit={onEdit}
              onArchive={onArchive}
              onAddChild={onAddChild}
              depth={0}
              t={t}
            />
          ))}
        </ul>

        <DragOverlay>
          {activeNode ? (
            <div className="stratum-tree__drag-overlay">
              {activeNode.name}
            </div>
          ) : null}
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

.stratum-tree__drag-handle {
  width: 14px;
  font-size: 10px;
  color: var(--color-400, #94A3B8);
  flex-shrink: 0;
  cursor: grab;
  line-height: 1;
  touch-action: none;
  user-select: none;
}

.stratum-tree__drag-handle:active {
  cursor: grabbing;
}

.stratum-tree__drag-overlay {
  padding: 6px 16px;
  min-width: 140px;
  background: var(--bg-card, white);
  border: 1px solid var(--color-accent, #0D9488);
  border-radius: var(--radius-sm, 4px);
  box-shadow: var(--shadow-md, 0 2px 8px rgba(0,0,0,0.15));
  font-size: 0.8125rem;
  font-family: var(--font-body, 'DM Sans', system-ui, sans-serif);
  color: var(--text-primary, #0F172A);
  cursor: grabbing;
  white-space: nowrap;
}

.stratum-tree__actions {
  display: inline-flex;
  gap: 2px;
  margin-left: auto;
}

.stratum-tree__action-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 11px;
  padding: 0 2px;
  color: var(--color-400, #94A3B8);
  line-height: 1;
}

.stratum-tree__action-btn:hover {
  color: var(--text-primary, #0F172A);
}

.stratum-tree__action-btn--danger:hover {
  color: var(--color-error, #DC2626);
}

[data-theme="dark"] .stratum-tree__drag-overlay {
  background: var(--color-800, #1E293B);
  color: #e2e8f0;
  box-shadow: 0 4px 16px rgba(0,0,0,0.3);
}
`;
