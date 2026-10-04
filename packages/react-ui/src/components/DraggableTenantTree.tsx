/**
 * DraggableTenantTree: TenantTree with drag-and-drop support.
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
import { useTreeKeyboard } from "../hooks/use-tree-keyboard.js";
import type { MessageKey } from "../i18n.js";
import { isolationBadgeKey } from "./TenantTree.js";

type ItemProps = ReturnType<typeof useTreeKeyboard>["itemProps"];

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

  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: node.id,
    data: { node },
    attributes: { tabIndex: rowTabIndex },
  });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `drop-${node.id}`,
    data: { node },
  });

  return (
    <li
      role="treeitem"
      aria-expanded={hasChildren ? node.expanded : undefined}
      aria-selected={selectedId === node.id}
      {...itemProps(node.id)}
    >
      <div
        ref={setDropRef}
        className={[
          "stratum-tree__node",
          `stratum-tree__node--d${Math.min(depth, 4)}`,
          selectedId === node.id ? "stratum-tree__node--selected" : "",
          isDragging ? "stratum-tree__node--dragging" : "",
          isOver ? "stratum-tree__node--drop-target" : "",
        ].filter(Boolean).join(" ")}
        style={{
          marginInlineStart: `calc(${depth} * var(--stratum-tree-indent, 28px))`,
          opacity: isDragging ? 0.4 : 1,
        }}
      >
        {/* Drag handle: only this initiates drag */}
        <span
          ref={setDragRef}
          {...attributes}
          {...listeners}
          className="stratum-tree__drag-handle"
          aria-label={t("tenantTree.moveTenant", name)}
          title="Drag to reparent or reorder"
          onClick={(e) => e.stopPropagation()}
        >
          ⠿
        </span>

        {hasChildren ? (
          <button
            type="button"
            className="stratum-tree__toggle"
            tabIndex={-1}
            onClick={(e) => { e.stopPropagation(); onToggle(node.id); }}
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

        {/* CRUD actions */}
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
              activeId={activeId}
              itemProps={itemProps}
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
  const { activeId, itemProps, rootProps } = useTreeKeyboard(tree, tenant?.id, onSelect, toggleExpand);

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
    (parentId: string | null, _nodes: TenantTreeNode[] = tree): TenantTreeNode[] => {
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
        // Sibling reorder: find target's position and place dragged there
        const siblings = findSiblings(targetNode.parent_id);
        const targetIndex = siblings.findIndex((s) => s.id === targetId);
        const position = Math.max(0, targetIndex);

        await apiCall(`/api/v1/tenants/${encodeURIComponent(draggedId)}/reorder`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ position }),
        });
        toast.success(`Reordered "${draggedNode.name}"`);
        onReorder?.(draggedId, position);
      } else {
        // Reparent: move to target as new parent
        await apiCall(`/api/v1/tenants/${encodeURIComponent(draggedId)}/move`, {
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
      <DndContext
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <ul role="tree" {...rootProps}>
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
              activeId={activeId}
              itemProps={itemProps}
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
