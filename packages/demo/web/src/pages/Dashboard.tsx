import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  useTenant,
  useStratum,
  useTenantTree,
  ConfigEditor,
  ConfigInheritanceVisualizer,
  PermissionEditor,
  WebhookEditor,
} from "@stratum-hq/react";
import type { TenantTreeNode } from "@stratum-hq/react";

// ── Types ────────────────────────────────────────────────────────────────────

type TenantRecord = NonNullable<ReturnType<typeof useTenant>["tenant"]>;

// Loose shapes for the untyped context payload.
type ContextConfigEntry = { value: unknown; locked?: boolean; inherited?: boolean };
type ContextPermissionEntry = { value: unknown; mode?: string };
type ContextTenant = { id?: string; name?: string };

interface ResolvedConfigEntry {
  inherited: boolean;
  locked: boolean;
}

interface PermissionEntry {
  locked: boolean;
  delegated: boolean;
}

interface SecurityEvent {
  id: number;
  event_type: string;
  severity: string;
  source_ip: string | null;
  description: string;
  created_at: string;
}

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

interface ApiKeyEntry {
  id: string;
  tenant_id: string | null;
  name: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  expires_at: string | null;
}

interface WebhookEntry {
  id: string;
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

type TabId = "overview" | "config" | "permissions" | "events" | "audit" | "api-keys" | "webhooks";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "config", label: "Config" },
  { id: "permissions", label: "Permissions" },
  { id: "events", label: "Events" },
  { id: "audit", label: "Audit" },
  { id: "api-keys", label: "API keys" },
  { id: "webhooks", label: "Webhooks" },
];

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The first characters of an ID: enough to tell two rows apart on screen. */
function shortId(id: string): string {
  return id.slice(0, 8);
}

// ── Shared pieces ────────────────────────────────────────────────────────────

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  const titleId = useId();
  return (
    <section className="demo-section" aria-labelledby={titleId}>
      <div className="demo-section-header">
        <h3 id={titleId} className="demo-section-title">{title}</h3>
        {description && <p className="demo-section-desc">{description}</p>}
      </div>
      {children}
    </section>
  );
}

// ── Breadcrumb ───────────────────────────────────────────────────────────────

const bandForDepth = (depth: number) => `var(--stratum-tree-band-${Math.min(depth, 4)})`;

function findAncestry(tree: TenantTreeNode[], targetId: string): TenantTreeNode[] {
  for (const node of tree) {
    if (node.id === targetId) return [node];
    const below = findAncestry(node.children, targetId);
    if (below.length > 0) return [node, ...below];
  }
  return [];
}

function Breadcrumb({ tenantId }: { tenantId: string }) {
  const { tree } = useTenantTree();
  const ancestry = useMemo(() => findAncestry(tree, tenantId), [tree, tenantId]);

  if (ancestry.length === 0) return null;

  return (
    <nav aria-label="Tenant path">
      <ol className="demo-breadcrumb">
        {ancestry.map((node, i) => (
          <li key={node.id} aria-current={i === ancestry.length - 1 ? "page" : undefined}>
            <span className="demo-swatch" style={{ background: bandForDepth(node.depth) }} />
            {node.name}
          </li>
        ))}
      </ol>
    </nav>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────

interface SummaryCounts {
  config: { total: number; inherited: number; locked: number } | null;
  permissions: { total: number; locked: number; delegated: number } | null;
  events: number | null;
  audit: number | null;
  keys: { total: number; active: number; revoked: number } | null;
  webhooks: number | null;
}

/**
 * Return the counts for the Overview, fetched directly.
 *
 * The Overview used to mount every section out of sight to read their counts,
 * which loaded six tables nobody saw. A count that fails to load is null.
 */
function useSummaryCounts(tenantId: string): SummaryCounts | null {
  const { apiCall } = useStratum();
  const [counts, setCounts] = useState<SummaryCounts | null>(null);

  useEffect(() => {
    let current = true;
    setCounts(null);
    const id = encodeURIComponent(tenantId);
    Promise.allSettled([
      apiCall<Record<string, ResolvedConfigEntry>>(`/api/v1/tenants/${id}/config`),
      apiCall<Record<string, PermissionEntry>>(`/api/v1/tenants/${id}/permissions`),
      fetch(`/api/events/${id}`).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<SecurityEvent[]>;
      }),
      apiCall<AuditEntry[]>(`/api/v1/audit-logs?tenant_id=${id}&limit=20`),
      apiCall<ApiKeyEntry[]>(`/api/v1/api-keys?tenant_id=${id}`),
      apiCall<WebhookEntry[]>(`/api/v1/webhooks?tenant_id=${id}`),
    ]).then(([config, permissions, events, audit, keys, webhooks]) => {
      if (!current) return;
      const value = <T,>(r: PromiseSettledResult<T>) => (r.status === "fulfilled" ? r.value : null);
      const length = (r: PromiseSettledResult<unknown>) => {
        const v = value(r);
        return Array.isArray(v) ? v.length : null;
      };
      const configEntries = value(config) ? Object.values(value(config)!) : null;
      const permissionEntries = value(permissions) ? Object.values(value(permissions)!) : null;
      const keyList = value(keys);
      setCounts({
        config: configEntries && {
          total: configEntries.length,
          inherited: configEntries.filter((e) => e.inherited).length,
          locked: configEntries.filter((e) => e.locked).length,
        },
        permissions: permissionEntries && {
          total: permissionEntries.length,
          locked: permissionEntries.filter((p) => p.locked).length,
          delegated: permissionEntries.filter((p) => p.delegated).length,
        },
        events: length(events),
        audit: length(audit),
        keys: Array.isArray(keyList)
          ? {
              total: keyList.length,
              active: keyList.filter((k) => !k.revoked_at).length,
              revoked: keyList.filter((k) => k.revoked_at).length,
            }
          : null,
        webhooks: length(webhooks),
      });
    });
    return () => {
      current = false;
    };
  }, [apiCall, tenantId]);

  return counts;
}

function TenantContextTable({ tenant }: { tenant: TenantRecord }) {
  const rows: [string, string, boolean][] = [
    ["Name", tenant.name, false],
    ["ID", tenant.id, true],
    ["Slug", tenant.slug, true],
    ["Ancestry path", tenant.ancestry_path, true],
    ["Depth", String(tenant.depth), false],
    ["Isolation strategy", tenant.isolation_strategy, true],
    ["Status", tenant.status, false],
  ];

  return (
    <Section
      title="Tenant context"
      description="Position in the hierarchy. The ancestry_path traces the UUID chain from root to this tenant. RLS uses this to scope queries."
    >
      <div className="demo-table-scroll">
        <table className="demo-table">
          <tbody>
            {rows.map(([label, value, mono]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td className={mono ? "demo-mono" : undefined}>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function OverviewTab({ tenant, onOpenTab }: { tenant: TenantRecord; onOpenTab: (tab: TabId) => void }) {
  const counts = useSummaryCounts(tenant.id);

  // A figure of undefined means that count did not load.
  const rows: { tab: TabId; name: string; figure: number | undefined; detail: string }[] = counts
    ? [
        {
          tab: "config",
          name: "Config",
          figure: counts.config?.total,
          detail: `${counts.config?.inherited} inherited, ${counts.config?.locked} locked`,
        },
        {
          tab: "permissions",
          name: "Permissions",
          figure: counts.permissions?.total,
          detail: `${counts.permissions?.locked} locked, ${counts.permissions?.delegated} delegated`,
        },
        { tab: "events", name: "Security events", figure: counts.events ?? undefined, detail: "RLS-scoped events for this tenant" },
        { tab: "audit", name: "Audit log", figure: counts.audit ?? undefined, detail: "Recent mutations recorded" },
        {
          tab: "api-keys",
          name: "Active API keys",
          figure: counts.keys?.active,
          detail: `${counts.keys?.total} total, ${counts.keys?.revoked} revoked`,
        },
        { tab: "webhooks", name: "Webhooks", figure: counts.webhooks ?? undefined, detail: "Endpoints that receive lifecycle events" },
      ]
    : [];

  return (
    <>
      <Section title="Summary">
        {counts === null ? (
          <p className="demo-status" role="status">Loading counts...</p>
        ) : (
          <ul className="demo-summary">
            {rows.map((row) => (
              <li key={row.tab}>
                <button type="button" onClick={() => onOpenTab(row.tab)}>
                  <span className="demo-summary-name">{row.name}</span>
                  <span className="demo-summary-figure">{row.figure ?? "–"}</span>
                  {row.figure === undefined ? (
                    <span className="demo-summary-detail demo-error">Error: the count did not load.</span>
                  ) : (
                    <span className="demo-summary-detail">{row.detail}</span>
                  )}
                  <span className="demo-summary-open" aria-hidden="true">Open</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <TenantContextTable tenant={tenant} />
    </>
  );
}

// ── Events and audit ─────────────────────────────────────────────────────────

function SecurityEventsTab({ tenantId }: { tenantId: string }) {
  const [events, setEvents] = useState<SecurityEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setEvents(null);
    setError(null);
    fetch(`/api/events/${encodeURIComponent(tenantId)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<SecurityEvent[]>;
      })
      .then((data) => current && setEvents(data))
      .catch((err: unknown) => current && setError(errorText(err)));
    return () => {
      current = false;
    };
  }, [tenantId]);

  return (
    <Section
      title="Security events"
      description={
        <>
          PostgreSQL row-level security filters these rows. The database scopes each query to the current tenant
          with <span className="demo-mono">SET LOCAL app.current_tenant_id</span>. Switch tenants to see different events.
        </>
      }
    >
      {error ? (
        <p className="demo-status demo-error" role="alert">Error: {error}</p>
      ) : events === null ? (
        <p className="demo-status" role="status">Loading events...</p>
      ) : events.length === 0 ? (
        <p className="demo-status">No events for this tenant. RLS scopes events, so switch tenants to see others.</p>
      ) : (
        <div className="demo-table-scroll">
          <table className="demo-table">
            <thead>
              <tr>
                <th>Severity</th>
                <th>Type</th>
                <th>Description</th>
                <th>Source IP</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td><span className={`demo-tag demo-tag--${e.severity}`}>{e.severity}</span></td>
                  <td>{e.event_type}</td>
                  <td className="demo-muted demo-wrap">{e.description}</td>
                  <td className="demo-mono demo-muted">{e.source_ip || "–"}</td>
                  <td className="demo-muted">{new Date(e.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function AuditLogTab({ tenantId }: { tenantId: string }) {
  const { apiCall } = useStratum();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setEntries(null);
    setError(null);
    apiCall<AuditEntry[]>(`/api/v1/audit-logs?tenant_id=${encodeURIComponent(tenantId)}&limit=20`)
      .then((data) => current && setEntries(Array.isArray(data) ? data : []))
      .catch((err: unknown) => current && setError(errorText(err)));
    return () => {
      current = false;
    };
  }, [apiCall, tenantId]);

  return (
    <Section
      title="Audit log"
      description="Immutable audit trail. Every mutation is recorded with actor identity, resource type, and timestamp."
    >
      {error ? (
        <p className="demo-status demo-error" role="alert">Error: {error}</p>
      ) : entries === null ? (
        <p className="demo-status" role="status">Loading the audit log...</p>
      ) : entries.length === 0 ? (
        <p className="demo-status">No audit entries for this tenant.</p>
      ) : (
        <div className="demo-table-scroll">
          <table className="demo-table">
            <thead>
              <tr>
                <th>Action</th>
                <th>Resource</th>
                <th>Actor</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="demo-mono">{e.action}</td>
                  <td className="demo-mono demo-muted">
                    {e.resource_type}{e.resource_id ? ` (${shortId(e.resource_id)})` : ""}
                  </td>
                  <td className="demo-mono demo-muted">{e.actor_type}: {shortId(e.actor_id)}</td>
                  <td className="demo-muted">{new Date(e.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

// ── API keys ─────────────────────────────────────────────────────────────────

/**
 * Return a Revoke button that revokes only after a second, explicit choice.
 *
 * Revoking cannot be undone, and every client that holds the key stops working.
 * The prompt names the key and the start of its ID, and focus moves to Keep key.
 */
function RevokeKeyButton({ apiKey, onRevoke }: { apiKey: ApiKeyEntry; onRevoke: () => Promise<void> }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const promptId = useId();
  const revokeRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const backedOut = useRef(false);

  useEffect(() => {
    if (armed) {
      keepRef.current?.focus();
    } else if (backedOut.current) {
      backedOut.current = false;
      revokeRef.current?.focus();
    }
  }, [armed]);

  const keep = () => {
    backedOut.current = true;
    setArmed(false);
  };

  if (!armed) {
    return (
      <button ref={revokeRef} type="button" className="demo-button" onClick={() => setArmed(true)}>
        Revoke
      </button>
    );
  }

  return (
    <span
      className="demo-confirm"
      role="group"
      aria-labelledby={promptId}
      onKeyDown={(e) => {
        if (e.key === "Escape") keep();
      }}
    >
      <span id={promptId} className="demo-confirm__prompt">
        Revoke {apiKey.name ?? "this key"} (ID {shortId(apiKey.id)})? Clients that use it stop working.
      </span>
      <button
        type="button"
        className="demo-button demo-button--danger"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await onRevoke();
          setBusy(false);
          keep();
        }}
      >
        Revoke key
      </button>
      <button ref={keepRef} type="button" className="demo-button" onClick={keep} disabled={busy}>
        Keep key
      </button>
    </span>
  );
}

function ApiKeysTab({ tenantId }: { tenantId: string }) {
  const { apiCall } = useStratum();
  const [keys, setKeys] = useState<ApiKeyEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newKeyName, setNewKeyName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    try {
      const data = await apiCall<ApiKeyEntry[]>(`/api/v1/api-keys?tenant_id=${encodeURIComponent(tenantId)}`);
      setKeys(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(errorText(err));
    }
  }, [apiCall, tenantId]);

  useEffect(() => {
    setKeys(null);
    setError(null);
    setCreatedKey(null);
    void fetchKeys();
  }, [fetchKeys]);

  const create = async () => {
    setCreating(true);
    setCreatedKey(null);
    setError(null);
    try {
      const res = await apiCall<{ plaintext_key: string }>("/api/v1/api-keys", {
        method: "POST",
        body: JSON.stringify({ tenant_id: tenantId, name: newKeyName.trim() || undefined }),
      });
      setCreatedKey(res.plaintext_key);
      setNewKeyName("");
      await fetchKeys();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (keyId: string) => {
    setError(null);
    try {
      await apiCall(`/api/v1/api-keys/${encodeURIComponent(keyId)}`, { method: "DELETE" });
      await fetchKeys();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <Section
      title="API keys"
      description="Keys are scoped to this tenant and its descendants. The plaintext key is shown only once, at creation."
    >
      {createdKey && (
        <p className="demo-key-banner" role="status">
          <strong>Copy the new key now. It is not shown again.</strong>
          <code>{createdKey}</code>
        </p>
      )}
      {error && <p className="demo-status demo-error" role="alert">Error: {error}</p>}
      {keys === null ? (
        !error && <p className="demo-status" role="status">Loading API keys...</p>
      ) : keys.length === 0 ? (
        <p className="demo-status">No API keys for this tenant. Create one below.</p>
      ) : (
        <div className="demo-table-scroll">
          <table className="demo-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>ID</th>
                <th>Status</th>
                <th>Last used</th>
                <th>Created</th>
                <th><span className="demo-visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td className="demo-mono">{k.name || "–"}</td>
                  <td className="demo-mono demo-muted">{shortId(k.id)}</td>
                  <td>
                    <span className={k.revoked_at ? "demo-tag" : "demo-tag demo-tag--active"}>
                      {k.revoked_at ? "Revoked" : "Active"}
                    </span>
                  </td>
                  <td className="demo-muted">{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : "Never"}</td>
                  <td className="demo-muted">{new Date(k.created_at).toLocaleString()}</td>
                  <td>{!k.revoked_at && <RevokeKeyButton apiKey={k} onRevoke={() => revoke(k.id)} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form
        className="demo-section-footer"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <input
          className="demo-input"
          aria-label="Key name (optional)"
          placeholder="Key name (optional)"
          value={newKeyName}
          onChange={(e) => setNewKeyName(e.target.value)}
        />
        <button type="submit" className="demo-button demo-button--flow" disabled={creating}>
          {creating ? "Creating..." : "Create key"}
        </button>
      </form>
    </Section>
  );
}

// ── Resolved context dialog ──────────────────────────────────────────────────

interface ResolvedContext {
  config: Record<string, ContextConfigEntry>;
  permissions: Record<string, ContextPermissionEntry>;
  path: ContextTenant[];
}

/**
 * Return a modal dialog with the tenant's resolved config, permissions and path.
 *
 * showModal() makes the rest of the page inert and keeps focus inside. Escape,
 * the Close button and a click on the backdrop call onClose. The caller moves
 * focus back to the control that opened it.
 */
function ResolvedContextDialog({ tenant, onClose }: { tenant: TenantRecord; onClose: () => void }) {
  const { apiCall } = useStratum();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [context, setContext] = useState<ResolvedContext | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  useEffect(() => {
    let current = true;
    const id = encodeURIComponent(tenant.id);
    Promise.all([
      apiCall<{ resolved_config?: Record<string, ContextConfigEntry>; resolved_permissions?: Record<string, ContextPermissionEntry> }>(
        `/api/v1/tenants/${id}/context`,
      ),
      apiCall<ContextTenant[]>(`/api/v1/tenants/${id}/ancestors`),
    ])
      .then(([ctx, ancestors]) => {
        if (!current) return;
        setContext({
          config: ctx.resolved_config ?? {},
          permissions: ctx.resolved_permissions ?? {},
          path: [...(Array.isArray(ancestors) ? ancestors : []), { id: tenant.id, name: tenant.name }],
        });
      })
      .catch((err: unknown) => current && setError(errorText(err)));
    return () => {
      current = false;
    };
  }, [apiCall, tenant.id, tenant.name]);

  return (
    <dialog
      ref={dialogRef}
      className="demo-dialog"
      aria-labelledby={titleId}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="demo-dialog-header">
        <div>
          <h2 id={titleId}>Resolved context</h2>
          <span className="demo-meta">{tenant.name} &middot; {shortId(tenant.id)}</span>
        </div>
        <button type="button" className="demo-button" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="demo-dialog-body">
        {error ? (
          <p className="demo-error" role="alert">Error: the context did not load. {error}</p>
        ) : context === null ? (
          <p className="demo-muted" role="status">Loading context...</p>
        ) : (
          <>
            <h3>Resolved config</h3>
            <table className="demo-table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Value</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(context.config).map(([key, entry]) => (
                  <tr key={key}>
                    <td className="demo-mono">{key}</td>
                    <td className="demo-mono demo-muted">{JSON.stringify(entry.value)}</td>
                    <td>
                      {entry.locked ? (
                        <span className="stratum-badge stratum-badge--locked">Locked</span>
                      ) : entry.inherited ? (
                        <span className="stratum-badge stratum-badge--inherited">Inherited</span>
                      ) : (
                        <span className="stratum-badge stratum-badge--own">Own</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3>Resolved permissions</h3>
            <table className="demo-table">
              <thead>
                <tr>
                  <th>Permission</th>
                  <th>Value</th>
                  <th>Mode</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(context.permissions).map(([key, perm]) => (
                  <tr key={key}>
                    <td className="demo-mono">{key}</td>
                    <td>{perm.value ? "Yes" : "No"}</td>
                    <td className="demo-mono demo-muted">{perm.mode}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3>Hierarchy path</h3>
            <ol className="demo-path">
              {context.path.map((node, i) => (
                <li key={node.id ?? i}>
                  <span
                    className="demo-tag"
                    aria-current={i === context.path.length - 1 ? "location" : undefined}
                  >
                    {node.name ?? "Unknown"}
                  </span>
                </li>
              ))}
            </ol>
            {context.path.length === 1 && <p className="demo-muted">Root tenant: it has no ancestors.</p>}
          </>
        )}
      </div>
    </dialog>
  );
}

// ── Dashboard ────────────────────────────────────────────────────────────────

function TabPanel({ tab, tenant, onOpenTab }: { tab: TabId; tenant: TenantRecord; onOpenTab: (tab: TabId) => void }) {
  switch (tab) {
    case "overview":
      return <OverviewTab tenant={tenant} onOpenTab={onOpenTab} />;
    case "config":
      return (
        <>
          <Section
            title="Config inheritance"
            description="Config values flow from root to leaf. Children inherit parent values unless they override them. A parent can lock a key so descendants cannot override it."
          >
            <div className="demo-section-body">
              <ConfigEditor />
            </div>
          </Section>
          <Section title="Inheritance cascade" description="How config flows from this tenant to its children.">
            <div className="demo-section-body">
              <ConfigInheritanceVisualizer />
            </div>
          </Section>
        </>
      );
    case "permissions":
      return (
        <Section
          title="Permissions"
          description="Permissions cascade through the tree in three delegation modes: LOCKED (immutable), INHERITED (overridable), and DELEGATED (overridable and re-delegatable)."
        >
          <div className="demo-section-body">
            <PermissionEditor />
          </div>
        </Section>
      );
    case "events":
      return <SecurityEventsTab tenantId={tenant.id} />;
    case "audit":
      return <AuditLogTab tenantId={tenant.id} />;
    case "api-keys":
      return <ApiKeysTab tenantId={tenant.id} />;
    case "webhooks":
      return (
        <Section title="Webhooks" description="Endpoints that receive tenant lifecycle events, signed with HMAC.">
          <div className="demo-section-body">
            <WebhookEditor />
          </div>
        </Section>
      );
  }
}

export function Dashboard() {
  const { tenant, loading } = useTenant();
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [contextOpen, setContextOpen] = useState(false);
  const tabRefs = useRef(new Map<TabId, HTMLButtonElement>());
  const contextButtonRef = useRef<HTMLButtonElement>(null);
  const contextClosed = useRef(false);

  // Focus returns to the opener only after the dialog has unmounted. While the
  // dialog is modal, the rest of the page is inert and cannot take focus.
  useEffect(() => {
    if (!contextOpen && contextClosed.current) {
      contextClosed.current = false;
      contextButtonRef.current?.focus();
    }
  }, [contextOpen]);

  // Each tenant opens on its Overview.
  useEffect(() => {
    setActiveTab("overview");
  }, [tenant?.id]);

  if (loading && !tenant) {
    return <p className="demo-status" role="status">Loading tenant...</p>;
  }

  if (!tenant) {
    return (
      <div className="demo-empty">
        <h2>Select a tenant</h2>
        <p>Pick any tenant in the hierarchy to see its context, config inheritance, permissions and security events.</p>
      </div>
    );
  }

  // Arrow keys move between tabs, as the WAI-ARIA tabs pattern expects.
  const onTabKeyDown = (e: React.KeyboardEvent) => {
    const index = TABS.findIndex((t) => t.id === activeTab);
    const next =
      e.key === "ArrowRight" ? (index + 1) % TABS.length
      : e.key === "ArrowLeft" ? (index - 1 + TABS.length) % TABS.length
      : e.key === "Home" ? 0
      : e.key === "End" ? TABS.length - 1
      : null;
    if (next === null) return;
    e.preventDefault();
    setActiveTab(TABS[next].id);
    tabRefs.current.get(TABS[next].id)?.focus();
  };

  return (
    <div className="demo-dashboard">
      <Breadcrumb tenantId={tenant.id} />

      <div className="demo-dash-header">
        <h2 className="demo-dash-title">{tenant.name}</h2>
        <span className="demo-meta">{tenant.slug}</span>
        <span className="demo-meta">depth {tenant.depth}</span>
        <button
          ref={contextButtonRef}
          type="button"
          className="demo-button demo-button--flow"
          onClick={() => setContextOpen(true)}
          title="Inherited config, permissions and the ancestor chain"
        >
          Resolved context
        </button>
      </div>

      <div className="demo-tabs" role="tablist" aria-label="Dashboard sections" onKeyDown={onTabKeyDown}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            ref={(el) => {
              if (el) tabRefs.current.set(tab.id, el);
              else tabRefs.current.delete(tab.id);
            }}
            id={`tab-${tab.id}`}
            type="button"
            className="demo-tab"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`panel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div id={`panel-${activeTab}`} role="tabpanel" aria-labelledby={`tab-${activeTab}`}>
        <TabPanel tab={activeTab} tenant={tenant} onOpenTab={setActiveTab} />
      </div>

      {contextOpen && (
        <ResolvedContextDialog
          tenant={tenant}
          onClose={() => {
            contextClosed.current = true;
            setContextOpen(false);
          }}
        />
      )}
    </div>
  );
}
