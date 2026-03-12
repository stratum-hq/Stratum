import React, { useEffect, useState } from "react";
import { useTenant, useStratum } from "@stratum/react";

// ── Types ────────────────────────────────────────────────────────────────────

interface ConfigInheritanceEntry {
  key: string;
  resolved_value: unknown;
  source_tenant_id: string;
  source_tenant_name?: string;
  locked: boolean;
}

interface ConfigInheritanceResponse {
  data?: ConfigInheritanceEntry[];
  inheritance?: ConfigInheritanceEntry[];
}

interface PermissionEntry {
  key: string;
  granted: boolean;
  delegation_mode: string;
  revocation_mode?: string;
  source_tenant_id?: string;
}

interface PermissionsResponse {
  data?: Record<string, PermissionEntry>;
  permissions?: Record<string, PermissionEntry>;
}

interface SecurityEvent {
  id: number;
  event_type: string;
  severity: string;
  source_ip: string | null;
  description: string;
  created_at: string;
}

// ── Shared styles ────────────────────────────────────────────────────────────

const sectionStyle: React.CSSProperties = {
  background: "white",
  border: "1px solid #e2e8f0",
  borderRadius: 6,
  marginBottom: 20,
  overflow: "hidden",
};

const sectionHeaderStyle: React.CSSProperties = {
  padding: "12px 16px",
  borderBottom: "1px solid #f1f5f9",
  background: "#f8fafc",
  display: "flex",
  alignItems: "baseline",
  gap: 12,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: "#0f172a",
  textTransform: "uppercase" as const,
  letterSpacing: "0.05em",
  margin: 0,
};

const explanationStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#94a3b8",
  fontStyle: "italic",
  margin: 0,
};

const monoStyle: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 12,
};

const severityColors: Record<string, string> = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#22c55e",
  info: "#3b82f6",
};

// ── Section: Tenant Context ──────────────────────────────────────────────────

function TenantContextSection() {
  const { tenant } = useTenant();
  if (!tenant) return null;

  const rows = [
    ["Name", tenant.name, false],
    ["ID", tenant.id, true],
    ["Slug", tenant.slug, true],
    ["Ancestry Path", tenant.ancestry_path, true],
    ["Depth", String(tenant.depth), false],
    ["Isolation Strategy", tenant.isolation_strategy, true],
    ["Status", tenant.status, false],
  ] as [string, string, boolean][];

  return (
    <div style={sectionStyle}>
      <div style={sectionHeaderStyle}>
        <span style={sectionTitleStyle}>Tenant Context</span>
        <span style={explanationStyle}>
          Every tenant has a position in the hierarchy. The ancestry_path traces the UUID chain from root to this tenant.
          Row-Level Security uses this to scope all database queries.
        </span>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <tbody>
          {rows.map(([label, value, isMono]) => (
            <tr key={label} style={{ borderBottom: "1px solid #f8fafc" }}>
              <td style={{ padding: "8px 16px", color: "#64748b", fontWeight: 500, width: 160, whiteSpace: "nowrap" }}>{label}</td>
              <td style={{ padding: "8px 16px", ...(isMono ? monoStyle : {}), color: "#0f172a", wordBreak: "break-all" }}>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Section: Config Inheritance ──────────────────────────────────────────────

function ConfigInheritanceSection() {
  const { tenant } = useTenant();
  const { apiCall } = useStratum();
  const [data, setData] = useState<ConfigInheritanceEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenant) { setData([]); return; }
    setLoading(true);
    setError(null);
    apiCall<ConfigInheritanceResponse>(`/api/v1/tenants/${tenant.id}/config/inheritance`)
      .then((res) => {
        const entries = res.data ?? res.inheritance ?? (Array.isArray(res) ? res as ConfigInheritanceEntry[] : []);
        setData(entries);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [tenant?.id]);

  return (
    <div style={sectionStyle}>
      <div style={sectionHeaderStyle}>
        <span style={sectionTitleStyle}>Config Inheritance</span>
        <span style={explanationStyle}>
          Config values flow root&rarr;leaf. Children inherit parent values unless they override.
          Parents can lock a key to prevent descendants from overriding.
        </span>
      </div>
      {loading && <div style={{ padding: "12px 16px", fontSize: 13, color: "#94a3b8" }}>Loading...</div>}
      {error && <div style={{ padding: "12px 16px", fontSize: 13, color: "#ef4444" }}>Error: {error}</div>}
      {!loading && !error && data.length === 0 && (
        <div style={{ padding: "12px 16px", fontSize: 13, color: "#94a3b8" }}>No config entries</div>
      )}
      {!loading && data.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
              <th style={{ padding: "8px 16px", textAlign: "left", fontWeight: 600, color: "#475569" }}>Key</th>
              <th style={{ padding: "8px 16px", textAlign: "left", fontWeight: 600, color: "#475569" }}>Resolved Value</th>
              <th style={{ padding: "8px 16px", textAlign: "left", fontWeight: 600, color: "#475569" }}>Source Tenant</th>
              <th style={{ padding: "8px 16px", textAlign: "left", fontWeight: 600, color: "#475569" }}>Locked</th>
            </tr>
          </thead>
          <tbody>
            {data.map((entry) => (
              <tr key={entry.key} style={{ borderBottom: "1px solid #f8fafc" }}>
                <td style={{ padding: "8px 16px", ...monoStyle, color: "#0f172a" }}>{entry.key}</td>
                <td style={{ padding: "8px 16px", ...monoStyle, color: "#0f172a", maxWidth: 260, wordBreak: "break-all" }}>
                  {JSON.stringify(entry.resolved_value)}
                </td>
                <td style={{ padding: "8px 16px", ...monoStyle, color: "#64748b", fontSize: 11 }}>
                  {entry.source_tenant_name || entry.source_tenant_id || "—"}
                </td>
                <td style={{ padding: "8px 16px" }}>
                  {entry.locked ? (
                    <span style={{ fontSize: 11, fontWeight: 600, color: "#dc2626", background: "#fef2f2", padding: "2px 8px", borderRadius: 10 }}>LOCKED</span>
                  ) : (
                    <span style={{ fontSize: 11, color: "#94a3b8" }}>—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Section: Permissions ─────────────────────────────────────────────────────

function PermissionsSection() {
  const { tenant } = useTenant();
  const { apiCall } = useStratum();
  const [data, setData] = useState<PermissionEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenant) { setData([]); return; }
    setLoading(true);
    setError(null);
    apiCall<PermissionsResponse | Record<string, PermissionEntry>>(`/api/v1/tenants/${tenant.id}/permissions`)
      .then((res) => {
        let record: Record<string, PermissionEntry> = {};
        if (res && typeof res === "object" && ("data" in res || "permissions" in res)) {
          const typed = res as PermissionsResponse;
          record = typed.data ?? typed.permissions ?? {};
        } else {
          record = res as Record<string, PermissionEntry>;
        }
        setData(
          Object.entries(record).map(([k, val]) => ({ ...val, key: k }))
        );
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [tenant?.id]);

  const delegationColor: Record<string, string> = {
    LOCKED: "#dc2626",
    INHERITED: "#2563eb",
    DELEGATED: "#059669",
  };

  return (
    <div style={sectionStyle}>
      <div style={sectionHeaderStyle}>
        <span style={sectionTitleStyle}>Permissions</span>
        <span style={explanationStyle}>
          Permissions cascade through the tree with three delegation modes:
          LOCKED (immutable), INHERITED (overridable), and DELEGATED (overridable + re-delegatable).
        </span>
      </div>
      {loading && <div style={{ padding: "12px 16px", fontSize: 13, color: "#94a3b8" }}>Loading...</div>}
      {error && <div style={{ padding: "12px 16px", fontSize: 13, color: "#ef4444" }}>Error: {error}</div>}
      {!loading && !error && data.length === 0 && (
        <div style={{ padding: "12px 16px", fontSize: 13, color: "#94a3b8" }}>No permissions defined</div>
      )}
      {!loading && data.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
              <th style={{ padding: "8px 16px", textAlign: "left", fontWeight: 600, color: "#475569" }}>Permission</th>
              <th style={{ padding: "8px 16px", textAlign: "left", fontWeight: 600, color: "#475569" }}>Granted</th>
              <th style={{ padding: "8px 16px", textAlign: "left", fontWeight: 600, color: "#475569" }}>Delegation Mode</th>
              <th style={{ padding: "8px 16px", textAlign: "left", fontWeight: 600, color: "#475569" }}>Revocation Mode</th>
            </tr>
          </thead>
          <tbody>
            {data.map((perm) => (
              <tr key={perm.key} style={{ borderBottom: "1px solid #f8fafc" }}>
                <td style={{ padding: "8px 16px", ...monoStyle, color: "#0f172a" }}>{perm.key}</td>
                <td style={{ padding: "8px 16px" }}>
                  <span style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: perm.granted ? "#059669" : "#dc2626",
                    background: perm.granted ? "#f0fdf4" : "#fef2f2",
                    padding: "2px 8px",
                    borderRadius: 10,
                  }}>
                    {perm.granted ? "YES" : "NO"}
                  </span>
                </td>
                <td style={{ padding: "8px 16px" }}>
                  <span style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: delegationColor[perm.delegation_mode] || "#64748b",
                    background: "#f8fafc",
                    padding: "2px 8px",
                    borderRadius: 10,
                    border: `1px solid ${delegationColor[perm.delegation_mode] || "#e2e8f0"}22`,
                  }}>
                    {perm.delegation_mode || "—"}
                  </span>
                </td>
                <td style={{ padding: "8px 16px", fontSize: 12, color: "#64748b" }}>
                  {perm.revocation_mode || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Section: Security Events (RLS Demo) ─────────────────────────────────────

function SecurityEventsSection() {
  const { tenant } = useTenant();
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenant) { setEvents([]); return; }
    setLoading(true);
    setError(null);
    fetch(`/api/events/${tenant.id}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<SecurityEvent[]>;
      })
      .then((data) => setEvents(data))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [tenant?.id]);

  return (
    <div style={sectionStyle}>
      <div style={sectionHeaderStyle}>
        <span style={sectionTitleStyle}>Security Events — RLS Demo</span>
        <span style={explanationStyle}>
          Filtered by PostgreSQL Row-Level Security. The database scopes queries to the current tenant
          via <span style={monoStyle}>SET LOCAL app.current_tenant_id</span>. Switch tenants to see different events — no application-level filtering needed.
        </span>
      </div>
      {loading && <div style={{ padding: "12px 16px", fontSize: 13, color: "#94a3b8" }}>Loading...</div>}
      {error && <div style={{ padding: "12px 16px", fontSize: 13, color: "#ef4444" }}>Error: {error}</div>}
      {!loading && !error && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
              <th style={{ padding: "8px 16px", textAlign: "left", fontWeight: 600, color: "#475569" }}>Severity</th>
              <th style={{ padding: "8px 16px", textAlign: "left", fontWeight: 600, color: "#475569" }}>Type</th>
              <th style={{ padding: "8px 16px", textAlign: "left", fontWeight: 600, color: "#475569" }}>Description</th>
              <th style={{ padding: "8px 16px", textAlign: "left", fontWeight: 600, color: "#475569" }}>Source IP</th>
              <th style={{ padding: "8px 16px", textAlign: "left", fontWeight: 600, color: "#475569" }}>Time</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} style={{ borderBottom: "1px solid #f8fafc" }}>
                <td style={{ padding: "8px 16px" }}>
                  <span style={{
                    display: "inline-block",
                    padding: "2px 8px",
                    borderRadius: 10,
                    fontSize: 11,
                    fontWeight: 700,
                    color: "white",
                    background: severityColors[e.severity] || "#94a3b8",
                  }}>
                    {e.severity.toUpperCase()}
                  </span>
                </td>
                <td style={{ padding: "8px 16px", color: "#0f172a" }}>{e.event_type}</td>
                <td style={{ padding: "8px 16px", color: "#475569" }}>{e.description}</td>
                <td style={{ padding: "8px 16px", ...monoStyle, color: "#64748b" }}>{e.source_ip || "—"}</td>
                <td style={{ padding: "8px 16px", color: "#94a3b8", fontSize: 12 }}>{new Date(e.created_at).toLocaleString()}</td>
              </tr>
            ))}
            {events.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: "24px 16px", textAlign: "center", color: "#94a3b8" }}>
                  No events for this tenant
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Dashboard ────────────────────────────────────────────────────────────────

export function Dashboard() {
  const { tenant, loading } = useTenant();

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 64, color: "#94a3b8", fontSize: 14 }}>
        Loading tenant...
      </div>
    );
  }

  if (!tenant) {
    return (
      <div style={{ textAlign: "center", padding: 64 }}>
        <div style={{ fontSize: 15, color: "#475569", marginBottom: 8 }}>Select a tenant from the sidebar</div>
        <div style={{ fontSize: 13, color: "#94a3b8" }}>
          Click any tenant in the hierarchy to explore its context, config inheritance, permissions, and security events.
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 960 }}>
      <div style={{ marginBottom: 20, display: "flex", alignItems: "baseline", gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 18, color: "#0f172a" }}>{tenant.name}</h2>
        <span style={{ ...monoStyle, fontSize: 12, color: "#94a3b8" }}>{tenant.slug}</span>
        <span style={{ fontSize: 12, color: "#64748b", background: "#f1f5f9", padding: "2px 8px", borderRadius: 4 }}>
          depth {tenant.depth}
        </span>
      </div>

      <TenantContextSection />
      <ConfigInheritanceSection />
      <PermissionsSection />
      <SecurityEventsSection />
    </div>
  );
}
