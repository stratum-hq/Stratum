import React, { useEffect, useState } from "react";
import { useTenant } from "@stratum/react";

interface SecurityEvent {
  id: number;
  event_type: string;
  severity: string;
  source_ip: string | null;
  description: string;
  created_at: string;
}

const severityColors: Record<string, string> = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#22c55e",
};

export function Dashboard() {
  const { tenant } = useTenant();
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tenant) { setEvents([]); return; }
    setLoading(true);
    fetch(`/api/events/${tenant.id}`)
      .then((r) => r.json() as Promise<SecurityEvent[]>)
      .then((data) => setEvents(data))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, [tenant?.id]);

  if (!tenant) {
    return (
      <div style={{ textAlign: "center", padding: 48, color: "#6b7280" }}>
        <h2>Select a tenant to view security events</h2>
        <p>Use the Tenants tab to browse and select a tenant from the hierarchy.</p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 16, marginBottom: 24 }}>
        <div style={{ background: "#f8fafc", padding: 16, borderRadius: 8, flex: 1, border: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: 12, color: "#64748b", textTransform: "uppercase" }}>Tenant</div>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{tenant.name}</div>
          <div style={{ fontSize: 13, color: "#94a3b8" }}>{tenant.slug}</div>
        </div>
        <div style={{ background: "#f8fafc", padding: 16, borderRadius: 8, flex: 1, border: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: 12, color: "#64748b", textTransform: "uppercase" }}>Isolation</div>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{tenant.isolation_strategy}</div>
        </div>
        <div style={{ background: "#f8fafc", padding: 16, borderRadius: 8, flex: 1, border: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: 12, color: "#64748b", textTransform: "uppercase" }}>Events</div>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{events.length}</div>
        </div>
      </div>

      <h3>Security Events {loading && "(loading...)"}</h3>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #e2e8f0", textAlign: "left" }}>
            <th style={{ padding: "8px 12px" }}>Severity</th>
            <th style={{ padding: "8px 12px" }}>Type</th>
            <th style={{ padding: "8px 12px" }}>Description</th>
            <th style={{ padding: "8px 12px" }}>Source IP</th>
            <th style={{ padding: "8px 12px" }}>Time</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
              <td style={{ padding: "8px 12px" }}>
                <span style={{
                  display: "inline-block",
                  padding: "2px 8px",
                  borderRadius: 10,
                  fontSize: 11,
                  fontWeight: 600,
                  color: "white",
                  background: severityColors[e.severity] || "#94a3b8",
                }}>
                  {e.severity.toUpperCase()}
                </span>
              </td>
              <td style={{ padding: "8px 12px" }}>{e.event_type}</td>
              <td style={{ padding: "8px 12px" }}>{e.description}</td>
              <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: 13 }}>{e.source_ip || "—"}</td>
              <td style={{ padding: "8px 12px", color: "#64748b" }}>{new Date(e.created_at).toLocaleString()}</td>
            </tr>
          ))}
          {events.length === 0 && !loading && (
            <tr><td colSpan={5} style={{ padding: 24, textAlign: "center", color: "#94a3b8" }}>No events for this tenant</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
