import React from "react";
import { useAuditLogs } from "../hooks/use-audit-logs.js";
import { TableSkeleton } from "./TableSkeleton.js";

export interface AuditLogViewerProps {
  limit?: number;
  className?: string;
}

const ACTION_VARIANTS: Record<string, string> = {
  "tenant.created": "stratum-badge--own",
  "tenant.updated": "stratum-badge--inherited",
  "tenant.deleted": "stratum-badge--locked",
  "tenant.moved": "stratum-badge--inherited",
  "tenant.reordered": "stratum-badge--inherited",
  "config.updated": "stratum-badge--inherited",
  "config.deleted": "stratum-badge--locked",
  "permission.created": "stratum-badge--own",
  "permission.deleted": "stratum-badge--locked",
};

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diff = now - d.getTime();
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return d.toLocaleDateString();
  } catch {
    return iso;
  }
}

export function AuditLogViewer({ limit = 20, className }: AuditLogViewerProps) {
  const { entries, loading, error } = useAuditLogs(limit);

  if (loading) {
    return (
      <div className={`stratum-audit-viewer ${className || ""}`}>
        <TableSkeleton rows={5} columns={4} />
      </div>
    );
  }

  if (error) {
    return <div className={className}>Failed to load audit logs: {error.message}</div>;
  }

  return (
    <div className={`stratum-audit-viewer ${className || ""}`}>
      <table className="stratum-audit-viewer__table">
        <thead>
          <tr>
            <th>Action</th>
            <th>Resource</th>
            <th>Actor</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td>
                <span className={`stratum-badge ${ACTION_VARIANTS[entry.action] || ""}`}>
                  {entry.action}
                </span>
              </td>
              <td>
                {entry.resource_type && (
                  <span>
                    {entry.resource_type}
                    {entry.resource_id && <code> {entry.resource_id.slice(0, 8)}...</code>}
                  </span>
                )}
              </td>
              <td>{entry.actor || "system"}</td>
              <td>{formatTime(entry.created_at)}</td>
            </tr>
          ))}
          {entries.length === 0 && (
            <tr>
              <td colSpan={4} style={{ textAlign: "center", padding: "16px" }}>
                No audit entries yet. Actions will appear here as you use the platform.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
