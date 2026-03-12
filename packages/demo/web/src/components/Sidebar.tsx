import React from "react";
import { useTenantTree, useTenant } from "@stratum/react";
import type { TenantTreeNode } from "@stratum/react";

function TreeNode({
  node,
  selectedId,
  onSelect,
  onToggle,
}: {
  node: TenantTreeNode;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isSelected = node.id === selectedId;

  const depthColors: Record<number, string> = {
    0: "#3b82f6",
    1: "#8b5cf6",
    2: "#10b981",
    3: "#f59e0b",
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
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={node.slug}>
          {node.name}
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
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const { tree, loading, toggleExpand } = useTenantTree();
  const { tenant, switchTenant } = useTenant();

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
          />
        ))}
      </div>
    </aside>
  );
}
