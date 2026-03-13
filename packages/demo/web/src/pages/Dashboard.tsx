import React, { useEffect, useState } from "react";
import { useTenant, useStratum } from "@stratum/react";

// ── Types ────────────────────────────────────────────────────────────────────

interface ConfigInheritanceEntry {
  key: string;
  value: unknown;
  source_tenant_id: string;
  inherited: boolean;
  locked: boolean;
}

interface ConfigInheritanceResponse {
  data?: ConfigInheritanceEntry[];
  inheritance?: ConfigInheritanceEntry[];
}

interface PermissionEntry {
  policy_id: string;
  key: string;
  value: unknown;
  mode: string;
  source_tenant_id: string;
  locked: boolean;
  delegated: boolean;
}

interface PermissionsResponse {
  [key: string]: PermissionEntry;
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

  // Inline edit state
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editLocked, setEditLocked] = useState(false);
  const [mutating, setMutating] = useState(false);

  // Add config form state
  const [addKey, setAddKey] = useState("");
  const [addValue, setAddValue] = useState("");
  const [addLocked, setAddLocked] = useState(false);

  const fetchConfig = () => {
    if (!tenant) { setData([]); return; }
    setLoading(true);
    setError(null);
    apiCall<ConfigInheritanceResponse>(`/api/v1/tenants/${tenant.id}/config/inheritance`)
      .then((res) => {
        if (Array.isArray(res)) {
          setData(res as ConfigInheritanceEntry[]);
        } else if (res && typeof res === "object") {
          // API returns Record<string, ConfigEntry> — convert to array
          const obj = (res as { data?: unknown; inheritance?: unknown });
          const source = obj.data ?? obj.inheritance ?? res;
          if (Array.isArray(source)) {
            setData(source as ConfigInheritanceEntry[]);
          } else if (source && typeof source === "object") {
            setData(Object.values(source) as ConfigInheritanceEntry[]);
          } else {
            setData([]);
          }
        } else {
          setData([]);
        }
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchConfig(); }, [tenant?.id]);

  const handleEdit = (entry: ConfigInheritanceEntry) => {
    setEditingKey(entry.key);
    setEditValue(JSON.stringify(entry.value));
    setEditLocked(entry.locked);
  };

  const handleEditSubmit = (key: string) => {
    if (!tenant) return;
    setMutating(true);
    let parsedValue: unknown;
    try { parsedValue = JSON.parse(editValue); } catch { parsedValue = editValue; }
    apiCall(`/api/v1/tenants/${tenant.id}/config/${key}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: parsedValue, locked: editLocked }),
    })
      .then(() => { setEditingKey(null); fetchConfig(); })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setMutating(false));
  };

  const handleDelete = (key: string) => {
    if (!tenant) return;
    setMutating(true);
    apiCall(`/api/v1/tenants/${tenant.id}/config/${key}`, { method: "DELETE" })
      .then(() => fetchConfig())
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setMutating(false));
  };

  const handleAdd = () => {
    if (!tenant || !addKey.trim()) return;
    setMutating(true);
    let parsedValue: unknown;
    try { parsedValue = JSON.parse(addValue); } catch { parsedValue = addValue; }
    apiCall(`/api/v1/tenants/${tenant.id}/config/${addKey.trim()}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: parsedValue, locked: addLocked }),
    })
      .then(() => { setAddKey(""); setAddValue(""); setAddLocked(false); fetchConfig(); })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setMutating(false));
  };

  const isLocal = (entry: ConfigInheritanceEntry) => tenant && entry.source_tenant_id === tenant.id;

  const btnStyle: React.CSSProperties = {
    fontSize: 11, padding: "2px 8px", borderRadius: 4, border: "1px solid #e2e8f0",
    background: "#f8fafc", color: "#475569", cursor: "pointer", marginLeft: 4,
  };
  const inputStyle: React.CSSProperties = {
    fontSize: 12, padding: "4px 8px", borderRadius: 4, border: "1px solid #e2e8f0",
    ...monoStyle,
  };

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
              <th style={{ padding: "8px 16px", textAlign: "left", fontWeight: 600, color: "#475569" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.map((entry) => (
              <React.Fragment key={entry.key}>
                <tr style={{ borderBottom: "1px solid #f8fafc" }}>
                  <td style={{ padding: "8px 16px", ...monoStyle, color: "#0f172a" }}>{entry.key}</td>
                  <td style={{ padding: "8px 16px", ...monoStyle, color: "#0f172a", maxWidth: 260, wordBreak: "break-all" }}>
                    {JSON.stringify(entry.value)}
                  </td>
                  <td style={{ padding: "8px 16px", ...monoStyle, color: "#64748b", fontSize: 11 }}>
                    {entry.inherited ? "inherited" : "local"} ({entry.source_tenant_id?.slice(0, 8) || "—"})
                  </td>
                  <td style={{ padding: "8px 16px" }}>
                    {entry.locked ? (
                      <span style={{ fontSize: 11, fontWeight: 600, color: "#dc2626", background: "#fef2f2", padding: "2px 8px", borderRadius: 10 }}>LOCKED</span>
                    ) : (
                      <span style={{ fontSize: 11, color: "#94a3b8" }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: "8px 16px" }}>
                    {isLocal(entry) && (
                      <>
                        <button style={btnStyle} disabled={mutating} onClick={() => handleEdit(entry)}>Edit</button>
                        <button style={{ ...btnStyle, color: "#dc2626" }} disabled={mutating} onClick={() => handleDelete(entry.key)}>Delete Override</button>
                      </>
                    )}
                  </td>
                </tr>
                {editingKey === entry.key && (
                  <tr style={{ borderBottom: "1px solid #f8fafc", background: "#fefce8" }}>
                    <td colSpan={5} style={{ padding: "8px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 12, color: "#64748b" }}>Value:</span>
                        <input style={{ ...inputStyle, width: 200 }} value={editValue} onChange={(e) => setEditValue(e.target.value)} />
                        <label style={{ fontSize: 12, color: "#64748b", display: "flex", alignItems: "center", gap: 4 }}>
                          <input type="checkbox" checked={editLocked} onChange={(e) => setEditLocked(e.target.checked)} />
                          Locked
                        </label>
                        <button style={{ ...btnStyle, background: "#2563eb", color: "white", border: "none" }} disabled={mutating} onClick={() => handleEditSubmit(entry.key)}>Save</button>
                        <button style={btnStyle} onClick={() => setEditingKey(null)}>Cancel</button>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}

      {/* Add Config Form */}
      {tenant && (
        <div style={{ padding: "12px 16px", borderTop: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>
            Add a config override for this tenant. The value is JSON-parsed (falls back to string). Locking prevents descendants from overriding.
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <input style={{ ...inputStyle, width: 140 }} placeholder="key" value={addKey} onChange={(e) => setAddKey(e.target.value)} />
            <input style={{ ...inputStyle, width: 200 }} placeholder="value (JSON or string)" value={addValue} onChange={(e) => setAddValue(e.target.value)} />
            <label style={{ fontSize: 12, color: "#64748b", display: "flex", alignItems: "center", gap: 4 }}>
              <input type="checkbox" checked={addLocked} onChange={(e) => setAddLocked(e.target.checked)} />
              Locked
            </label>
            <button style={{ ...btnStyle, background: "#059669", color: "white", border: "none" }} disabled={mutating || !addKey.trim()} onClick={handleAdd}>Add Config</button>
          </div>
        </div>
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

  // Add permission form state
  const [addKey, setAddKey] = useState("");
  const [addMode, setAddMode] = useState("INHERITED");
  const [addRevocationMode, setAddRevocationMode] = useState("CASCADE");
  const [mutating, setMutating] = useState(false);

  const fetchPermissions = () => {
    if (!tenant) { setData([]); return; }
    setLoading(true);
    setError(null);
    apiCall<PermissionsResponse>(`/api/v1/tenants/${tenant.id}/permissions`)
      .then((res) => {
        setData(
          Object.entries(res).map(([k, val]) => ({ ...val, key: k }))
        );
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchPermissions(); }, [tenant?.id]);

  const handleAdd = () => {
    if (!tenant || !addKey.trim()) return;
    setMutating(true);
    apiCall(`/api/v1/tenants/${tenant.id}/permissions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: addKey.trim(), value: true, mode: addMode, revocation_mode: addRevocationMode }),
    })
      .then(() => { setAddKey(""); setAddMode("INHERITED"); setAddRevocationMode("CASCADE"); fetchPermissions(); })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setMutating(false));
  };

  const handleDelete = (policyId: string) => {
    if (!tenant) return;
    setMutating(true);
    apiCall(`/api/v1/tenants/${tenant.id}/permissions/${policyId}`, { method: "DELETE" })
      .then(() => fetchPermissions())
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setMutating(false));
  };

  const delegationColor: Record<string, string> = {
    LOCKED: "#dc2626",
    INHERITED: "#2563eb",
    DELEGATED: "#059669",
  };

  const inputStyle: React.CSSProperties = {
    fontSize: 12, padding: "4px 8px", borderRadius: 4, border: "1px solid #e2e8f0",
    ...monoStyle,
  };
  const btnStyle: React.CSSProperties = {
    fontSize: 11, padding: "2px 8px", borderRadius: 4, border: "1px solid #e2e8f0",
    background: "#f8fafc", color: "#475569", cursor: "pointer",
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
              <th style={{ padding: "8px 16px", textAlign: "left", fontWeight: 600, color: "#475569" }}>Value</th>
              <th style={{ padding: "8px 16px", textAlign: "left", fontWeight: 600, color: "#475569" }}>Mode</th>
              <th style={{ padding: "8px 16px", textAlign: "left", fontWeight: 600, color: "#475569" }}>Flags</th>
              <th style={{ padding: "8px 16px", textAlign: "left", fontWeight: 600, color: "#475569" }}>Actions</th>
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
                    color: perm.value ? "#059669" : "#dc2626",
                    background: perm.value ? "#f0fdf4" : "#fef2f2",
                    padding: "2px 8px",
                    borderRadius: 10,
                  }}>
                    {perm.value ? "YES" : "NO"}
                  </span>
                </td>
                <td style={{ padding: "8px 16px" }}>
                  <span style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: delegationColor[perm.mode] || "#64748b",
                    background: "#f8fafc",
                    padding: "2px 8px",
                    borderRadius: 10,
                    border: `1px solid ${delegationColor[perm.mode] || "#e2e8f0"}22`,
                  }}>
                    {perm.mode || "—"}
                  </span>
                </td>
                <td style={{ padding: "8px 16px", fontSize: 12 }}>
                  {perm.locked && <span style={{ color: "#dc2626", marginRight: 6 }}>locked</span>}
                  {perm.delegated && <span style={{ color: "#059669" }}>delegated</span>}
                  {!perm.locked && !perm.delegated && <span style={{ color: "#94a3b8" }}>—</span>}
                </td>
                <td style={{ padding: "8px 16px" }}>
                  {tenant && perm.source_tenant_id === tenant.id && (
                    <button style={{ ...btnStyle, color: "#dc2626", borderColor: "#fecaca" }} disabled={mutating} onClick={() => handleDelete(perm.policy_id)}>Delete</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Add Permission Form */}
      {tenant && (
        <div style={{ padding: "12px 16px", borderTop: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>
            Grant a new permission to this tenant. Mode controls how descendants can interact with it.
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <input style={{ ...inputStyle, width: 160 }} placeholder="permission.key" value={addKey} onChange={(e) => setAddKey(e.target.value)} />
            <select style={inputStyle} value={addMode} onChange={(e) => setAddMode(e.target.value)}>
              <option value="LOCKED">LOCKED</option>
              <option value="INHERITED">INHERITED</option>
              <option value="DELEGATED">DELEGATED</option>
            </select>
            <select style={inputStyle} value={addRevocationMode} onChange={(e) => setAddRevocationMode(e.target.value)}>
              <option value="CASCADE">CASCADE</option>
              <option value="SOFT">SOFT</option>
              <option value="PERMANENT">PERMANENT</option>
            </select>
            <button style={{ ...btnStyle, background: "#2563eb", color: "white", border: "none" }} disabled={mutating || !addKey.trim()} onClick={handleAdd}>Add Permission</button>
          </div>
        </div>
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

// ── Section: Audit Logs ──────────────────────────────────────────────────────

interface AuditEntry {
  id: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  actor_id: string;
  actor_type: string;
  tenant_id: string | null;
  created_at: string;
}

function AuditLogSection() {
  const { tenant } = useTenant();
  const { apiCall } = useStratum();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenant) { setEntries([]); return; }
    setLoading(true);
    setError(null);
    apiCall<AuditEntry[]>(`/api/v1/audit-logs?tenant_id=${tenant.id}&limit=20`)
      .then((data) => setEntries(Array.isArray(data) ? data : []))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [tenant?.id]);

  const actionColors: Record<string, string> = {
    "tenant.created": "#22c55e",
    "tenant.updated": "#3b82f6",
    "tenant.deleted": "#ef4444",
    "config.updated": "#8b5cf6",
    "permission.created": "#f59e0b",
  };

  return (
    <div style={sectionStyle}>
      <div style={sectionHeaderStyle}>
        <span style={sectionTitleStyle}>Audit Log</span>
        <span style={explanationStyle}>
          Immutable audit trail. Every mutation is recorded with actor identity, resource type, and timestamp.
        </span>
      </div>
      {loading && <div style={{ padding: "12px 16px", fontSize: 13, color: "#94a3b8" }}>Loading...</div>}
      {error && <div style={{ padding: "12px 16px", fontSize: 13, color: "#ef4444" }}>Error: {error}</div>}
      {!loading && !error && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
              <th style={{ padding: "8px 16px", textAlign: "left", fontWeight: 600, color: "#475569" }}>Action</th>
              <th style={{ padding: "8px 16px", textAlign: "left", fontWeight: 600, color: "#475569" }}>Resource</th>
              <th style={{ padding: "8px 16px", textAlign: "left", fontWeight: 600, color: "#475569" }}>Actor</th>
              <th style={{ padding: "8px 16px", textAlign: "left", fontWeight: 600, color: "#475569" }}>Time</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} style={{ borderBottom: "1px solid #f8fafc" }}>
                <td style={{ padding: "8px 16px" }}>
                  <span style={{
                    fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10,
                    color: actionColors[e.action] || "#64748b",
                    background: `${actionColors[e.action] || "#64748b"}11`,
                  }}>
                    {e.action}
                  </span>
                </td>
                <td style={{ padding: "8px 16px", ...monoStyle, color: "#64748b", fontSize: 11 }}>
                  {e.resource_type}{e.resource_id ? ` (${e.resource_id.slice(0, 8)}...)` : ""}
                </td>
                <td style={{ padding: "8px 16px", ...monoStyle, color: "#64748b", fontSize: 11 }}>
                  {e.actor_type}: {e.actor_id.slice(0, 8)}...
                </td>
                <td style={{ padding: "8px 16px", color: "#94a3b8", fontSize: 12 }}>
                  {new Date(e.created_at).toLocaleString()}
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={4} style={{ padding: "24px 16px", textAlign: "center", color: "#94a3b8" }}>
                  No audit entries for this tenant
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Section: API Keys ────────────────────────────────────────────────────────

interface ApiKeyEntry {
  id: string;
  tenant_id: string | null;
  name: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  expires_at: string | null;
}

function ApiKeySection() {
  const { tenant } = useTenant();
  const { apiCall } = useStratum();
  const [keys, setKeys] = useState<ApiKeyEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newKeyName, setNewKeyName] = useState("");
  const [mutating, setMutating] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const fetchKeys = () => {
    if (!tenant) { setKeys([]); return; }
    setLoading(true);
    setError(null);
    apiCall<ApiKeyEntry[]>(`/api/v1/api-keys?tenant_id=${tenant.id}`)
      .then((data) => setKeys(Array.isArray(data) ? data : []))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchKeys(); }, [tenant?.id]);

  const handleCreate = () => {
    if (!tenant) return;
    setMutating(true);
    setCreatedKey(null);
    apiCall<{ plaintext_key: string }>(`/api/v1/api-keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenant_id: tenant.id, name: newKeyName || undefined }),
    })
      .then((res) => { setCreatedKey(res.plaintext_key); setNewKeyName(""); fetchKeys(); })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setMutating(false));
  };

  const handleRevoke = (keyId: string) => {
    setMutating(true);
    apiCall(`/api/v1/api-keys/${keyId}`, { method: "DELETE" })
      .then(() => fetchKeys())
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setMutating(false));
  };

  const inputStyle: React.CSSProperties = {
    fontSize: 12, padding: "4px 8px", borderRadius: 4, border: "1px solid #e2e8f0", ...monoStyle,
  };
  const btnStyle: React.CSSProperties = {
    fontSize: 11, padding: "2px 8px", borderRadius: 4, border: "1px solid #e2e8f0",
    background: "#f8fafc", color: "#475569", cursor: "pointer",
  };

  return (
    <div style={sectionStyle}>
      <div style={sectionHeaderStyle}>
        <span style={sectionTitleStyle}>API Keys</span>
        <span style={explanationStyle}>
          Manage API keys for this tenant. Keys are scoped to the tenant and its descendants.
          The plaintext key is shown only once at creation.
        </span>
      </div>
      {loading && <div style={{ padding: "12px 16px", fontSize: 13, color: "#94a3b8" }}>Loading...</div>}
      {error && <div style={{ padding: "12px 16px", fontSize: 13, color: "#ef4444" }}>Error: {error}</div>}
      {createdKey && (
        <div style={{ padding: "12px 16px", background: "#f0fdf4", borderBottom: "1px solid #bbf7d0", fontSize: 12 }}>
          <strong>New key created — copy now, it won&apos;t be shown again:</strong>
          <code style={{ ...monoStyle, display: "block", marginTop: 4, padding: "6px 8px", background: "white", borderRadius: 4, wordBreak: "break-all" }}>
            {createdKey}
          </code>
        </div>
      )}
      {!loading && !error && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
              <th style={{ padding: "8px 16px", textAlign: "left", fontWeight: 600, color: "#475569" }}>Name</th>
              <th style={{ padding: "8px 16px", textAlign: "left", fontWeight: 600, color: "#475569" }}>Status</th>
              <th style={{ padding: "8px 16px", textAlign: "left", fontWeight: 600, color: "#475569" }}>Last Used</th>
              <th style={{ padding: "8px 16px", textAlign: "left", fontWeight: 600, color: "#475569" }}>Created</th>
              <th style={{ padding: "8px 16px", textAlign: "left", fontWeight: 600, color: "#475569" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} style={{ borderBottom: "1px solid #f8fafc" }}>
                <td style={{ padding: "8px 16px", ...monoStyle }}>{k.name || "—"}</td>
                <td style={{ padding: "8px 16px" }}>
                  {k.revoked_at ? (
                    <span style={{ fontSize: 11, fontWeight: 600, color: "#dc2626", background: "#fef2f2", padding: "2px 8px", borderRadius: 10 }}>REVOKED</span>
                  ) : (
                    <span style={{ fontSize: 11, fontWeight: 600, color: "#059669", background: "#f0fdf4", padding: "2px 8px", borderRadius: 10 }}>ACTIVE</span>
                  )}
                </td>
                <td style={{ padding: "8px 16px", color: "#94a3b8", fontSize: 12 }}>
                  {k.last_used_at ? new Date(k.last_used_at).toLocaleString() : "Never"}
                </td>
                <td style={{ padding: "8px 16px", color: "#94a3b8", fontSize: 12 }}>
                  {new Date(k.created_at).toLocaleString()}
                </td>
                <td style={{ padding: "8px 16px" }}>
                  {!k.revoked_at && (
                    <button style={{ ...btnStyle, color: "#dc2626" }} disabled={mutating} onClick={() => handleRevoke(k.id)}>Revoke</button>
                  )}
                </td>
              </tr>
            ))}
            {keys.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: "24px 16px", textAlign: "center", color: "#94a3b8" }}>
                  No API keys for this tenant
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {/* Create Key Form */}
      {tenant && (
        <div style={{ padding: "12px 16px", borderTop: "1px solid #e2e8f0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input style={{ ...inputStyle, width: 200 }} placeholder="Key name (optional)" value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} />
            <button style={{ ...btnStyle, background: "#2563eb", color: "white", border: "none" }} disabled={mutating} onClick={handleCreate}>Create Key</button>
          </div>
        </div>
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
      <AuditLogSection />
      <ApiKeySection />
    </div>
  );
}
