import React, { useState } from "react";
import { useTenantTree, useTenant, useStratum } from "@stratum/react";
import type { TenantTreeNode } from "@stratum/react";

function TreeNode({
  node,
  selectedId,
  onSelect,
  onToggle,
  onAddChild,
  addingParentId,
}: {
  node: TenantTreeNode;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onAddChild: (parentId: string) => void;
  addingParentId: string | null;
}) {
  const hasChildren = node.children.length > 0;
  const isSelected = node.id === selectedId;

  const depthColors: Record<number, string> = {
    0: "#3b82f6",
    1: "#8b5cf6",
    2: "#10b981",
    3: "#f59e0b",
    4: "#ef4444",
  };
  const dotColor = depthColors[node.depth] || "#94a3b8";

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 8px",
          paddingLeft: 8 + node.depth * 16,
          borderRadius: 4,
          cursor: "pointer",
          background: isSelected ? "#1e40af" : "transparent",
          color: isSelected ? "white" : "#e2e8f0",
          fontSize: 13,
          userSelect: "none",
        }}
        onClick={() => onSelect(node.id)}
      >
        {hasChildren ? (
          <span
            style={{ width: 14, fontSize: 10, color: isSelected ? "#93c5fd" : "#64748b", flexShrink: 0 }}
            onClick={(e) => { e.stopPropagation(); onToggle(node.id); }}
          >
            {node.expanded ? "▼" : "▶"}
          </span>
        ) : (
          <span style={{ width: 14, flexShrink: 0 }} />
        )}
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: dotColor, flexShrink: 0, display: "inline-block" }} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }} title={node.slug}>
          {node.name}
        </span>
        <span
          style={{
            fontSize: 14,
            color: isSelected ? "#93c5fd" : "#475569",
            cursor: "pointer",
            padding: "0 2px",
            flexShrink: 0,
            lineHeight: 1,
          }}
          title="Add child tenant"
          onClick={(e) => { e.stopPropagation(); onAddChild(node.id); }}
        >
          +
        </span>
      </div>
      {node.expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              selectedId={selectedId}
              onSelect={onSelect}
              onToggle={onToggle}
              onAddChild={onAddChild}
              addingParentId={addingParentId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
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
    fontSize: 11,
    padding: "3px 6px",
    borderRadius: 3,
    border: "1px solid #334155",
    background: "#1e293b",
    color: "#e2e8f0",
    width: "100%",
  };

  const btnSmall: React.CSSProperties = {
    fontSize: 10,
    padding: "2px 8px",
    borderRadius: 3,
    border: "none",
    cursor: "pointer",
  };

  return (
    <aside style={{
      width: 280,
      flexShrink: 0,
      background: "#0f172a",
      borderRight: "1px solid #1e293b",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    }}>
      <div style={{ padding: "12px 12px 8px", borderBottom: "1px solid #1e293b" }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Tenant Hierarchy
        </div>
        <div style={{ marginTop: 6, display: "flex", gap: 12, fontSize: 11, color: "#475569" }}>
          <span><span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#3b82f6", marginRight: 4 }} />MSSP</span>
          <span><span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#8b5cf6", marginRight: 4 }} />MSP</span>
          <span><span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#10b981", marginRight: 4 }} />Client</span>
        </div>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "8px 4px" }}>
        {loading && (
          <div style={{ padding: "16px 12px", fontSize: 13, color: "#475569" }}>Loading...</div>
        )}
        {!loading && tree.length === 0 && (
          <div style={{ padding: "16px 12px", fontSize: 13, color: "#475569" }}>No tenants found</div>
        )}
        {tree.map((node) => (
          <TreeNode
            key={node.id}
            node={node}
            selectedId={tenant?.id ?? null}
            onSelect={switchTenant}
            onToggle={toggleExpand}
            onAddChild={handleAddChild}
            addingParentId={addingParentId}
          />
        ))}
      </div>

      {/* Inline create form */}
      {addingParentId && (
        <div style={{ padding: "8px 12px", borderTop: "1px solid #1e293b", background: "#1e293b" }}>
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>
            {addingParentId === "__root__" ? "New root tenant" : "New child tenant"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <input style={inputStyle} placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
            <input style={inputStyle} placeholder="slug_name" value={newSlug} onChange={(e) => setNewSlug(e.target.value)} />
            {error && <div style={{ fontSize: 10, color: "#ef4444" }}>{error}</div>}
            <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
              <button
                style={{ ...btnSmall, background: "#2563eb", color: "white" }}
                disabled={creating || !newName.trim() || !newSlug.trim()}
                onClick={handleCreate}
              >
                {creating ? "..." : "Create"}
              </button>
              <button style={{ ...btnSmall, background: "#334155", color: "#94a3b8" }} onClick={handleCancel}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add root tenant button */}
      {!addingParentId && (
        <div style={{ padding: "8px 12px", borderTop: "1px solid #1e293b" }}>
          <button
            style={{
              ...btnSmall,
              width: "100%",
              padding: "5px 8px",
              background: "#1e293b",
              color: "#64748b",
              border: "1px solid #334155",
              fontSize: 11,
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
