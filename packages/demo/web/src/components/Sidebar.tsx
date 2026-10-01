import React, { useState } from "react";
import { useTenantTree, useTenant, useStratum } from "@stratum-hq/react";
import type { TenantTreeNode } from "@stratum-hq/react";
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  closestCenter,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";

// Depth swatches use the rock bands, shallow to deep (DESIGN.md).
const depthDotColors: Record<number, string> = {
  0: "var(--topsoil)", // root / MSSP
  1: "var(--clay)", // MSP
  2: "var(--sandstone-band)", // client
  3: "var(--limestone)",
  4: "var(--basalt)",
};

const depthLabels: Record<number, string> = {
  0: "MSSP",
  1: "MSP",
  2: "Client",
};

function TreeNode({
  node,
  selectedId,
  onSelect,
  onToggle,
  onAddChild,
  onEdit,
  onArchive,
}: {
  node: TenantTreeNode;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onAddChild: (parentId: string) => void;
  onEdit: (id: string, currentName: string) => void;
  onArchive: (id: string, name: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isSelected = node.id === selectedId;
  const dotColor = depthDotColors[node.depth] || "var(--basalt)";

  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: node.id,
    data: { node },
  });
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `drop-${node.id}`,
    data: { node },
  });

  return (
    <div>
      <div
        ref={setDropRef}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-xs, 4px)",
          padding: "6px 8px",
          paddingLeft: `${8 + node.depth * 16}px`,
          opacity: isDragging ? 0.4 : 1,
          outline: isOver ? "3px dashed var(--flow)" : "none",
          outlineOffset: "-2px",
          cursor: "pointer",
          background: isSelected ? "var(--accent)" : "transparent",
          color: isSelected ? "var(--on-accent)" : "var(--text-primary)",
          fontSize: "0.8125rem",
          fontFamily: "var(--font-body)",
          userSelect: "none",
          transition: "background 75ms cubic-bezier(0, 0, 0.2, 1)",
        }}
        onClick={() => onSelect(node.id)}
        onMouseEnter={(e) => {
          if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = "var(--surface-2)";
        }}
        onMouseLeave={(e) => {
          if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = "transparent";
        }}
      >
        {/* Drag handle: only this initiates drag */}
        <span
          ref={setDragRef}
          {...attributes}
          {...listeners}
          style={{
            width: 12,
            fontSize: 9,
            color: isSelected ? "var(--on-accent)" : "var(--text-tertiary)",
            flexShrink: 0,
            cursor: "grab",
            lineHeight: 1,
            touchAction: "none",
          }}
          title="Drag to reparent"
          onClick={(e) => e.stopPropagation()}
        >
          ⠿
        </span>
        {hasChildren ? (
          <span
            style={{
              width: 14,
              fontSize: 10,
              color: isSelected ? "var(--on-accent)" : "var(--text-tertiary)",
              flexShrink: 0,
              cursor: "pointer",
            }}
            onClick={(e) => { e.stopPropagation(); onToggle(node.id); }}
          >
            {node.expanded ? "\u25BC" : "\u25B6"}
          </span>
        ) : (
          <span style={{ width: 14, flexShrink: 0 }} />
        )}
        <span
          style={{
            width: 8,
            height: 8,
            background: dotColor,
            flexShrink: 0,
            display: "inline-block",
          }}
        />
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
            fontWeight: isSelected ? 600 : 400,
          }}
          title={`${node.name} (${node.slug})`}
        >
          {node.name}
        </span>
        {/* Inheritance indicator: teal accent for nodes with children (they can pass config down) */}
        {hasChildren && (
          <span
            style={{
              fontSize: 9,
              color: isSelected ? "var(--on-accent)" : "var(--flow)",
              flexShrink: 0,
            }}
            title="Has descendants (config inherits downward)"
          >
            {"\u2193"}
          </span>
        )}
        <span style={{ display: "flex", gap: "2px", flexShrink: 0, alignItems: "center" }}>
          <span
            style={{
              fontSize: 11,
              color: isSelected ? "var(--on-accent)" : "var(--text-tertiary)",
              cursor: "pointer",
              padding: "0 2px",
              lineHeight: 1,
            }}
            title="Edit tenant name"
            onClick={(e) => { e.stopPropagation(); onEdit(node.id, node.name); }}
          >
            ✎
          </span>
          <span
            style={{
              fontSize: 14,
              color: isSelected ? "var(--on-accent)" : "var(--text-tertiary)",
              cursor: "pointer",
              padding: "0 2px",
              lineHeight: 1,
            }}
            title="Add child tenant"
            onClick={(e) => { e.stopPropagation(); onAddChild(node.id); }}
          >
            +
          </span>
          {!hasChildren && (
            <span
              style={{
                fontSize: 11,
                color: isSelected ? "var(--on-accent)" : "var(--text-tertiary)",
                cursor: "pointer",
                padding: "0 2px",
                lineHeight: 1,
              }}
              title="Archive tenant"
              onClick={(e) => { e.stopPropagation(); onArchive(node.id, node.name); }}
            >
              ✕
            </span>
          )}
        </span>
      </div>
      {node.expanded && hasChildren && (
        <div>
          {/* Teal inheritance line */}
          <div style={{ position: "relative" }}>
            <div
              style={{
                position: "absolute",
                left: `${14 + node.depth * 16}px`,
                top: 0,
                bottom: 0,
                width: 1,
                background: "var(--flow)",
                opacity: 0.5,
              }}
            />
            {node.children.map((child) => (
              <TreeNode
                key={child.id}
                node={child}
                selectedId={selectedId}
                onSelect={onSelect}
                onToggle={onToggle}
                onAddChild={onAddChild}
                onEdit={onEdit}
                onArchive={onArchive}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function Sidebar({
  collapsed,
  onToggleCollapse,
}: {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const { tree, loading, toggleExpand, refresh } = useTenantTree();
  const { tenant, switchTenant } = useTenant();
  const { apiCall } = useStratum();

  const [addingParentId, setAddingParentId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAddChild = (parentId: string) => {
    setAddingParentId(parentId);
    setNewName("");
    setNewSlug("");
    setError(null);
  };

  const handleEdit = async (id: string, currentName: string) => {
    const newName = prompt("Rename tenant:", currentName);
    if (!newName || newName === currentName) return;
    try {
      await apiCall(`/api/v1/tenants/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to rename tenant");
    }
  };

  const handleArchive = async (id: string, name: string) => {
    if (!confirm(`Archive "${name}"? This will soft-delete the tenant.`)) return;
    try {
      await apiCall(`/api/v1/tenants/${id}`, { method: "DELETE" });
      refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to archive tenant. It may have children.");
    }
  };

  const [draggedNode, setDraggedNode] = useState<TenantTreeNode | null>(null);

  const handleDragStart = (event: DragStartEvent) => {
    setDraggedNode(event.active.data.current?.node ?? null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setDraggedNode(null);
    const { active, over } = event;
    if (!over) return;

    const draggedId = active.id as string;
    const targetId = (over.id as string).replace(/^drop-/, "");
    if (draggedId === targetId) return;

    try {
      await apiCall(`/api/v1/tenants/${draggedId}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_parent_id: targetId }),
      });
      refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to move tenant");
    }
  };

  const handleAddRoot = () => {
    setAddingParentId("__root__");
    setNewName("");
    setNewSlug("");
    setError(null);
  };

  const handleCreate = async () => {
    if (!newName.trim() || !newSlug.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        name: newName.trim(),
        slug: newSlug.trim(),
        isolation_strategy: "SHARED_RLS",
      };
      if (addingParentId && addingParentId !== "__root__") {
        body.parent_id = addingParentId;
      }
      const created = await apiCall<{ id: string }>("/api/v1/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setAddingParentId(null);
      setNewName("");
      setNewSlug("");
      await refresh();
      switchTenant(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const handleCancel = () => {
    setAddingParentId(null);
    setNewName("");
    setNewSlug("");
    setError(null);
  };

  const inputStyle: React.CSSProperties = {
    fontSize: "0.6875rem",
    padding: "3px 6px",
    border: "1px solid var(--rule)",
    background: "var(--surface-1)",
    boxShadow: "var(--shadow-sunk)",
    color: "var(--text-primary)",
    width: "100%",
    fontFamily: "var(--font-mono)",
  };

  const btnSmall: React.CSSProperties = {
    fontSize: "0.625rem",
    padding: "2px 8px",
    border: "none",
    cursor: "pointer",
    fontFamily: "var(--font-body)",
  };

  // If collapsed (tablet mode), render a narrow strip
  if (collapsed) {
    return (
      <aside
        className="stratum-sidebar stratum-sidebar-collapsed"
        style={{
          width: 48,
          flexShrink: 0,
          background: "var(--surface-0)",
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          paddingTop: "var(--space-md, 12px)",
        }}
      >
        <button
          onClick={onToggleCollapse}
          style={{
            background: "transparent",
            border: "none",
            color: "var(--text-secondary)",
            fontSize: 18,
            cursor: "pointer",
            padding: "var(--space-sm, 8px)",
          }}
          aria-label="Expand sidebar"
        >
          {"\u2630"}
        </button>
      </aside>
    );
  }

  return (
    <aside
      className="stratum-sidebar"
      style={{
        width: 240,
        flexShrink: 0,
        background: "var(--surface-0)",
        borderRight: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: "var(--font-body)",
        position: "relative",
        zIndex: 10,
      }}
    >
      {/* Sidebar header */}
      <div style={{
        padding: "var(--space-md, 12px) var(--space-md, 12px) var(--space-sm, 8px)",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div>
          <div style={{
            fontSize: "0.625rem",
            fontWeight: 600,
            color: "var(--text-secondary)",
            textTransform: "uppercase",
            letterSpacing: "0.14em",
            fontFamily: "var(--font-mono)",
          }}>
            Tenant Hierarchy
          </div>
          <div style={{
            marginTop: "var(--space-xs, 4px)",
            display: "flex",
            gap: "var(--space-md, 12px)",
            fontSize: "0.6875rem",
            color: "var(--text-secondary)",
          }}>
            <span>
              <span style={{
                display: "inline-block",
                width: 7,
                height: 7,
                background: depthDotColors[0],
                marginRight: "var(--space-xs, 4px)",
              }} />
              {depthLabels[0]}
            </span>
            <span>
              <span style={{
                display: "inline-block",
                width: 7,
                height: 7,
                background: depthDotColors[1],
                marginRight: "var(--space-xs, 4px)",
              }} />
              {depthLabels[1]}
            </span>
            <span>
              <span style={{
                display: "inline-block",
                width: 7,
                height: 7,
                background: depthDotColors[2],
                marginRight: "var(--space-xs, 4px)",
              }} />
              {depthLabels[2]}
            </span>
          </div>
        </div>
        {/* Collapse toggle for tablet */}
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-secondary)",
              fontSize: 16,
              cursor: "pointer",
              padding: "var(--space-xs, 4px)",
            }}
            aria-label="Collapse sidebar"
          >
            {"\u2630"}
          </button>
        )}
      </div>

      {/* Tree */}
      <div style={{ flex: 1, overflow: "auto", padding: "var(--space-sm, 8px) var(--space-xs, 4px)" }}>
        {loading && (
          <div style={{ padding: "var(--space-lg, 16px) var(--space-md, 12px)", fontSize: "0.8125rem", color: "var(--text-secondary)" }}>Loading...</div>
        )}
        {!loading && tree.length === 0 && (
          <div style={{ padding: "var(--space-lg, 16px) var(--space-md, 12px)", fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
            No tenants found. Create a root tenant below.
          </div>
        )}
        <DndContext
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          {tree.map((node) => (
            <TreeNode
              key={node.id}
              node={node}
              selectedId={tenant?.id ?? null}
              onSelect={switchTenant}
              onToggle={toggleExpand}
              onAddChild={handleAddChild}
              onEdit={handleEdit}
              onArchive={handleArchive}
            />
          ))}
          <DragOverlay>
            {draggedNode ? (
              <div style={{
                padding: "6px 16px",
                minWidth: 140,
                background: "var(--accent)",
                border: "none",
                clipPath: "var(--edge-row)",
                color: "var(--on-accent)",
                fontSize: "0.8125rem",
                fontFamily: "var(--font-body)",
                fontWeight: 600,
                whiteSpace: "nowrap",
              }}>
                {draggedNode.name}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      {/* Inline create form */}
      {addingParentId && (
        <div style={{
          padding: "var(--space-sm, 8px) var(--space-md, 12px)",
          borderTop: "1px solid var(--border)",
          background: "var(--surface-2)",
        }}>
          <div style={{ fontSize: "0.6875rem", color: "var(--text-secondary)", marginBottom: "var(--space-xs, 4px)" }}>
            {addingParentId === "__root__" ? "New root tenant" : "New child tenant"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs, 4px)" }}>
            <input style={inputStyle} placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
            <input style={inputStyle} placeholder="slug_name" value={newSlug} onChange={(e) => setNewSlug(e.target.value)} />
            {error && <div role="alert" style={{ fontSize: "0.625rem", color: "var(--accent-text)" }}>Error: {error}</div>}
            <div style={{ display: "flex", gap: "var(--space-xs, 4px)", marginTop: "var(--space-2xs, 2px)" }}>
              <button
                style={{ ...btnSmall, background: "var(--accent)", color: "var(--on-accent)" }}
                disabled={creating || !newName.trim() || !newSlug.trim()}
                onClick={handleCreate}
              >
                {creating ? "..." : "Create"}
              </button>
              <button style={{ ...btnSmall, background: "var(--surface-3)", color: "var(--text-primary)" }} onClick={handleCancel}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add root tenant button */}
      {!addingParentId && (
        <div style={{ padding: "var(--space-sm, 8px) var(--space-md, 12px)", borderTop: "1px solid var(--border)" }}>
          <button
            style={{
              ...btnSmall,
              width: "100%",
              padding: "5px 8px",
              background: "var(--surface-2)",
              color: "var(--text-primary)",
              border: "1px solid var(--rule)",
              fontSize: "0.6875rem",
            }}
            onClick={handleAddRoot}
          >
            + Add Root Tenant
          </button>
        </div>
      )}
    </aside>
  );
}
