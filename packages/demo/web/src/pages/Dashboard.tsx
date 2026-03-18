import React, { useEffect, useState, useMemo } from "react";
import { useTenant, useStratum, useTenantTree } from "@stratum-hq/react";
import type { TenantTreeNode } from "@stratum-hq/react";

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

// ── Tab definitions ──────────────────────────────────────────────────────────

type TabId = "overview" | "config" | "permissions" | "events" | "audit" | "api-keys";

interface TabDef {
  id: TabId;
  label: string;
  icon: string;
}

const TABS: TabDef[] = [
  { id: "overview", label: "Overview", icon: "◫" },
  { id: "config", label: "Config", icon: "⚙" },
  { id: "permissions", label: "Permissions", icon: "🔑" },
  { id: "events", label: "Events", icon: "⚡" },
  { id: "audit", label: "Audit", icon: "📋" },
  { id: "api-keys", label: "API Keys", icon: "🗝" },
];

// ── CSS-in-JS with design tokens ─────────────────────────────────────────────

const cssVars = `
@import url('https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700,900&display=swap');
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=JetBrains+Mono:wght@400;500;600&display=swap');

:root {
  /* Colors */
  --color-primary: #2563EB;
  --color-primary-hover: #1d4ed8;
  --color-accent: #0D9488;
  --color-accent-hover: #0F766E;
  --color-accent-light: #CCFBF1;
  --color-accent-muted: #F0FDFA;
  --color-success: #059669;
  --color-success-bg: #D1FAE5;
  --color-warning: #D97706;
  --color-warning-bg: #FEF3C7;
  --color-error: #DC2626;
  --color-error-bg: #FEE2E2;
  --color-info: #2563EB;
  --color-info-bg: #DBEAFE;

  /* Neutrals */
  --color-950: #0C1222;
  --color-900: #0F172A;
  --color-800: #1E293B;
  --color-700: #334155;
  --color-600: #475569;
  --color-500: #64748B;
  --color-400: #94A3B8;
  --color-300: #CBD5E1;
  --color-200: #E2E8F0;
  --color-100: #F1F5F9;
  --color-50: #F8FAFC;

  /* Typography */
  --font-display: 'Satoshi', system-ui, -apple-system, sans-serif;
  --font-body: 'DM Sans', system-ui, -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;

  /* Spacing */
  --space-2xs: 2px;
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 12px;
  --space-lg: 16px;
  --space-xl: 24px;
  --space-2xl: 32px;
  --space-3xl: 48px;

  /* Radius */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-xl: 12px;
  --radius-full: 9999px;

  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(12,18,34,0.05);
  --shadow-md: 0 2px 8px rgba(12,18,34,0.08), 0 1px 2px rgba(12,18,34,0.04);
  --shadow-lg: 0 4px 16px rgba(12,18,34,0.10), 0 2px 4px rgba(12,18,34,0.06);
  --shadow-xl: 0 8px 32px rgba(12,18,34,0.12), 0 4px 8px rgba(12,18,34,0.06);

  /* Motion */
  --ease-enter: cubic-bezier(0, 0, 0.2, 1);
  --ease-exit: cubic-bezier(0.4, 0, 1, 1);
  --ease-move: cubic-bezier(0.4, 0, 0.2, 1);
  --duration-micro: 75ms;
  --duration-short: 150ms;
  --duration-medium: 250ms;
  --duration-long: 400ms;
}

/* Dashboard responsive styles */
.stratum-dashboard {
  max-width: 1120px;
  font-family: var(--font-body);
}

.stratum-breadcrumb {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) 0;
  font-size: 0.8125rem;
  color: var(--color-500);
  font-family: var(--font-body);
  flex-wrap: wrap;
}

.stratum-breadcrumb-segment {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.stratum-breadcrumb-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  display: inline-block;
  flex-shrink: 0;
}

.stratum-breadcrumb-name {
  color: var(--color-600);
  font-weight: 500;
}

.stratum-breadcrumb-name.active {
  color: var(--color-900);
  font-weight: 700;
}

.stratum-breadcrumb-sep {
  color: var(--color-300);
  font-size: 0.75rem;
}

/* Dashboard header */
.stratum-dash-header {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  margin-bottom: var(--space-xl);
  flex-wrap: wrap;
}

.stratum-dash-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--color-900);
  font-family: var(--font-display);
}

.stratum-dash-slug {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--color-400);
}

.stratum-dash-depth {
  font-size: 0.75rem;
  color: var(--color-600);
  background: var(--color-100);
  padding: var(--space-2xs) var(--space-sm);
  border-radius: var(--radius-sm);
  font-family: var(--font-body);
}

.stratum-view-as-btn {
  margin-left: auto;
  padding: var(--space-xs) var(--space-md);
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-accent);
  background: var(--color-accent-muted);
  border: 1px solid var(--color-accent-light);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-family: var(--font-body);
  transition: background var(--duration-micro) var(--ease-enter),
              color var(--duration-micro) var(--ease-enter);
  white-space: nowrap;
}

.stratum-view-as-btn:hover {
  background: var(--color-accent-light);
  color: var(--color-accent-hover);
}

.stratum-view-as-btn:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 3px;
}

/* Tab bar */
.stratum-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--color-200);
  margin-bottom: var(--space-xl);
  overflow-x: auto;
  scrollbar-width: none;
}

.stratum-tabs::-webkit-scrollbar {
  display: none;
}

.stratum-tab {
  padding: var(--space-sm) var(--space-lg);
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--color-500);
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  white-space: nowrap;
  font-family: var(--font-body);
  transition: color var(--duration-short) var(--ease-enter),
              border-color var(--duration-short) var(--ease-enter);
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.stratum-tab:hover {
  color: var(--color-700);
}

.stratum-tab.active {
  color: var(--color-primary);
  border-bottom-color: var(--color-primary);
  font-weight: 600;
}

.stratum-tab:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}

.stratum-tab-icon {
  font-size: 0.875rem;
}

/* Tab content area */
.stratum-tab-content {
  animation: stratum-fade-in var(--duration-medium) var(--ease-enter);
}

@keyframes stratum-fade-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .stratum-tab-content { animation: none; }
  .stratum-tab { transition: none; }
  .stratum-view-as-btn { transition: none; }
}

/* Stat cards row */
.stratum-stat-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--space-md);
  margin-bottom: var(--space-xl);
}

.stratum-stat-card {
  background: white;
  border: 1px solid var(--color-200);
  border-radius: var(--radius-md);
  padding: var(--space-md) var(--space-lg);
  box-shadow: var(--shadow-sm);
}

.stratum-stat-label {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--color-500);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: var(--space-xs);
  font-family: var(--font-body);
}

.stratum-stat-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--color-900);
  font-family: var(--font-display);
  font-variant-numeric: tabular-nums;
}

.stratum-stat-value.accent {
  color: var(--color-accent);
}

.stratum-stat-value.primary {
  color: var(--color-primary);
}

.stratum-stat-value.warning {
  color: var(--color-warning);
}

.stratum-stat-value.success {
  color: var(--color-success);
}

.stratum-stat-value.error {
  color: var(--color-error);
}

/* Section card */
.stratum-section {
  background: white;
  border: 1px solid var(--color-200);
  border-radius: var(--radius-md);
  margin-bottom: var(--space-xl);
  overflow: hidden;
  box-shadow: var(--shadow-sm);
}

.stratum-section-header {
  padding: var(--space-md) var(--space-lg);
  border-bottom: 1px solid var(--color-100);
  background: var(--color-50);
  display: flex;
  align-items: baseline;
  gap: var(--space-md);
  flex-wrap: wrap;
}

.stratum-section-title {
  font-size: 0.8125rem;
  font-weight: 700;
  color: var(--color-900);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0;
  font-family: var(--font-display);
}

.stratum-section-desc {
  font-size: 0.75rem;
  color: var(--color-400);
  font-style: italic;
  margin: 0;
  font-family: var(--font-body);
}

/* Table styles */
.stratum-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8125rem;
  font-family: var(--font-body);
}

.stratum-table thead tr {
  border-bottom: 1px solid var(--color-200);
  background: var(--color-50);
}

.stratum-table th {
  padding: var(--space-sm) var(--space-lg);
  text-align: left;
  font-weight: 600;
  color: var(--color-600);
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.stratum-table td {
  padding: var(--space-sm) var(--space-lg);
  color: var(--color-900);
}

.stratum-table tbody tr {
  border-bottom: 1px solid var(--color-50);
  transition: background var(--duration-micro) var(--ease-enter);
}

.stratum-table tbody tr:hover {
  background: var(--color-50);
}

.stratum-mono {
  font-family: var(--font-mono);
  font-size: 0.75rem;
}

/* Badge styles */
.stratum-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  font-size: 0.6875rem;
  font-weight: 600;
  padding: var(--space-2xs) var(--space-sm);
  border-radius: var(--radius-full);
}

.stratum-badge.inherited {
  color: var(--color-accent);
  background: var(--color-accent-light);
}

.stratum-badge.locked {
  color: var(--color-warning);
  background: var(--color-warning-bg);
}

.stratum-badge.own {
  color: var(--color-600);
  background: var(--color-100);
}

.stratum-badge.success {
  color: var(--color-success);
  background: var(--color-success-bg);
}

.stratum-badge.error {
  color: var(--color-error);
  background: var(--color-error-bg);
}

.stratum-badge.info {
  color: var(--color-info);
  background: var(--color-info-bg);
}

/* Button styles */
.stratum-btn {
  font-size: 0.6875rem;
  font-weight: 500;
  padding: var(--space-2xs) var(--space-sm);
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-200);
  background: var(--color-50);
  color: var(--color-600);
  cursor: pointer;
  font-family: var(--font-body);
  transition: background var(--duration-micro) var(--ease-enter);
}

.stratum-btn:hover {
  background: var(--color-100);
}

.stratum-btn:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 3px;
}

.stratum-btn.primary {
  background: var(--color-primary);
  color: white;
  border-color: var(--color-primary);
}

.stratum-btn.primary:hover {
  background: var(--color-primary-hover);
}

.stratum-btn.accent {
  background: var(--color-accent);
  color: white;
  border-color: var(--color-accent);
}

.stratum-btn.accent:hover {
  background: var(--color-accent-hover);
}

.stratum-btn.success {
  background: var(--color-success);
  color: white;
  border-color: var(--color-success);
}

.stratum-btn.destructive {
  color: var(--color-error);
  border-color: var(--color-error-bg);
}

.stratum-btn.destructive:hover {
  background: var(--color-error-bg);
}

.stratum-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Input styles */
.stratum-input {
  font-size: 0.75rem;
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-200);
  font-family: var(--font-mono);
  color: var(--color-900);
  background: white;
  transition: border-color var(--duration-micro) var(--ease-enter);
}

.stratum-input:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
}

.stratum-select {
  font-size: 0.75rem;
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-200);
  font-family: var(--font-mono);
  color: var(--color-900);
  background: white;
}

/* Form row */
.stratum-form-row {
  padding: var(--space-md) var(--space-lg);
  border-top: 1px solid var(--color-200);
}

.stratum-form-hint {
  font-size: 0.75rem;
  color: var(--color-500);
  margin-bottom: var(--space-sm);
}

.stratum-form-controls {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-wrap: wrap;
}

/* Loading / Error / Empty */
.stratum-loading {
  padding: var(--space-md) var(--space-lg);
  font-size: 0.8125rem;
  color: var(--color-400);
}

.stratum-error {
  padding: var(--space-md) var(--space-lg);
  font-size: 0.8125rem;
  color: var(--color-error);
}

.stratum-empty {
  padding: var(--space-xl) var(--space-lg);
  text-align: center;
  color: var(--color-400);
  font-size: 0.8125rem;
}

/* Overview quick actions */
.stratum-overview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: var(--space-lg);
  margin-bottom: var(--space-xl);
}

.stratum-overview-card {
  background: white;
  border: 1px solid var(--color-200);
  border-radius: var(--radius-md);
  padding: var(--space-lg);
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.stratum-overview-card-title {
  font-family: var(--font-display);
  font-size: 0.875rem;
  font-weight: 700;
  color: var(--color-900);
}

.stratum-overview-card-value {
  font-family: var(--font-display);
  font-size: 1.5rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.stratum-overview-card-desc {
  font-size: 0.75rem;
  color: var(--color-500);
}

/* Severity colors */
.severity-critical { background: #ef4444; color: white; }
.severity-high { background: #f97316; color: white; }
.severity-medium { background: #eab308; color: #422006; }
.severity-low { background: #22c55e; color: white; }
.severity-info { background: #3b82f6; color: white; }

/* Edit row */
.stratum-edit-row {
  background: var(--color-warning-bg);
}

.stratum-edit-row td {
  padding: var(--space-sm) var(--space-lg);
}

/* Key created banner */
.stratum-key-banner {
  padding: var(--space-md) var(--space-lg);
  background: var(--color-success-bg);
  border-bottom: 1px solid #bbf7d0;
  font-size: 0.75rem;
}

.stratum-key-banner code {
  font-family: var(--font-mono);
  display: block;
  margin-top: var(--space-xs);
  padding: var(--space-xs) var(--space-sm);
  background: white;
  border-radius: var(--radius-sm);
  word-break: break-all;
}

/* Responsive breakpoints */
@media (max-width: 1024px) {
  .stratum-stat-cards {
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  }
  .stratum-overview-grid {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 768px) {
  .stratum-tabs {
    flex-wrap: nowrap;
    gap: 0;
    padding: 0 var(--space-sm);
  }
  .stratum-tab {
    padding: var(--space-sm) var(--space-md);
    font-size: 0.75rem;
  }
  .stratum-tab-icon {
    display: none;
  }
  .stratum-stat-cards {
    grid-template-columns: repeat(2, 1fr);
    gap: var(--space-sm);
  }
  .stratum-stat-card {
    padding: var(--space-sm) var(--space-md);
  }
  .stratum-stat-value {
    font-size: 1.25rem;
  }
  .stratum-overview-grid {
    grid-template-columns: 1fr;
  }
  .stratum-dash-header {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-sm);
  }
  .stratum-view-as-btn {
    margin-left: 0;
    align-self: flex-start;
  }
  .stratum-table {
    font-size: 0.75rem;
  }
  .stratum-table th,
  .stratum-table td {
    padding: var(--space-xs) var(--space-sm);
  }
  .stratum-section-header {
    flex-direction: column;
    gap: var(--space-xs);
  }
  .stratum-form-controls {
    flex-direction: column;
    align-items: stretch;
  }
  .stratum-form-controls .stratum-input,
  .stratum-form-controls .stratum-select {
    width: 100%;
  }
  .stratum-breadcrumb {
    font-size: 0.75rem;
  }
}
`;

// ── Breadcrumb helper ────────────────────────────────────────────────────────

const depthDotColors: Record<number, string> = {
  0: "#3b82f6", // blue — root/MSSP
  1: "#8b5cf6", // purple — MSP
  2: "#0D9488", // teal — client
  3: "#0D9488",
  4: "#0D9488",
};

function findAncestryNames(
  tree: TenantTreeNode[],
  targetId: string,
): { name: string; depth: number }[] {
  const path: { name: string; depth: number }[] = [];

  function walk(nodes: TenantTreeNode[], trail: { name: string; depth: number }[]): boolean {
    for (const node of nodes) {
      const currentTrail = [...trail, { name: node.name, depth: node.depth }];
      if (node.id === targetId) {
        path.push(...currentTrail);
        return true;
      }
      if (node.children.length > 0 && walk(node.children, currentTrail)) {
        return true;
      }
    }
    return false;
  }

  walk(tree, []);
  return path;
}

// ── Breadcrumb component ─────────────────────────────────────────────────────

function Breadcrumb({ tenantId }: { tenantId: string }) {
  const { tree } = useTenantTree();
  const ancestry = useMemo(() => findAncestryNames(tree, tenantId), [tree, tenantId]);

  if (ancestry.length === 0) return null;

  return (
    <nav className="stratum-breadcrumb" aria-label="Tenant hierarchy">
      {ancestry.map((seg, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="stratum-breadcrumb-sep">/</span>}
          <span className="stratum-breadcrumb-segment">
            <span
              className="stratum-breadcrumb-dot"
              style={{ background: depthDotColors[seg.depth] || "#94A3B8" }}
            />
            <span className={`stratum-breadcrumb-name${i === ancestry.length - 1 ? " active" : ""}`}>
              {seg.name}
            </span>
          </span>
        </React.Fragment>
      ))}
    </nav>
  );
}

// ── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  variant,
}: {
  label: string;
  value: string | number;
  variant?: "accent" | "primary" | "warning" | "success" | "error";
}) {
  return (
    <div className="stratum-stat-card">
      <div className="stratum-stat-label">{label}</div>
      <div className={`stratum-stat-value${variant ? ` ${variant}` : ""}`}>{value}</div>
    </div>
  );
}

// ── Section: Tenant Context (used in Overview) ──────────────────────────────

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
    <div className="stratum-section">
      <div className="stratum-section-header">
        <span className="stratum-section-title">Tenant Context</span>
        <span className="stratum-section-desc">
          Position in the hierarchy. The ancestry_path traces the UUID chain from root to this tenant. RLS uses this to scope queries.
        </span>
      </div>
      <table className="stratum-table">
        <tbody>
          {rows.map(([label, value, isMono]) => (
            <tr key={label}>
              <td style={{ color: "var(--color-500)", fontWeight: 500, width: 160, whiteSpace: "nowrap" }}>{label}</td>
              <td className={isMono ? "stratum-mono" : ""} style={{ wordBreak: "break-all" }}>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Section: Config Inheritance ──────────────────────────────────────────────

function ConfigInheritanceSection({ onStats }: { onStats?: (stats: { total: number; inherited: number; locked: number }) => void }) {
  const { tenant } = useTenant();
  const { apiCall } = useStratum();
  const [data, setData] = useState<ConfigInheritanceEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editLocked, setEditLocked] = useState(false);
  const [mutating, setMutating] = useState(false);

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

  useEffect(() => {
    if (onStats) {
      onStats({
        total: data.length,
        inherited: data.filter((d) => d.inherited).length,
        locked: data.filter((d) => d.locked).length,
      });
    }
  }, [data, onStats]);

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

  return (
    <div className="stratum-section">
      <div className="stratum-section-header">
        <span className="stratum-section-title">Config Inheritance</span>
        <span className="stratum-section-desc">
          Config values flow root&rarr;leaf. Children inherit parent values unless they override.
          Parents can lock a key to prevent descendants from overriding.
        </span>
      </div>
      {loading && <div className="stratum-loading">Loading...</div>}
      {error && <div className="stratum-error">Error: {error}</div>}
      {!loading && !error && data.length === 0 && (
        <div className="stratum-empty">No config entries. Add one below to get started.</div>
      )}
      {!loading && data.length > 0 && (
        <table className="stratum-table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Resolved Value</th>
              <th>Source</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.map((entry) => (
              <React.Fragment key={entry.key}>
                <tr>
                  <td className="stratum-mono">{entry.key}</td>
                  <td className="stratum-mono" style={{ maxWidth: 260, wordBreak: "break-all" }}>
                    {JSON.stringify(entry.value)}
                  </td>
                  <td>
                    {entry.inherited ? (
                      <span className="stratum-badge inherited">&uarr; inherited ({entry.source_tenant_id?.slice(0, 8) || "\u2014"})</span>
                    ) : (
                      <span className="stratum-badge own">&bull; local</span>
                    )}
                  </td>
                  <td>
                    {entry.locked ? (
                      <span className="stratum-badge locked">&darr; LOCKED</span>
                    ) : (
                      <span style={{ color: "var(--color-400)", fontSize: "0.6875rem" }}>&mdash;</span>
                    )}
                  </td>
                  <td>
                    {isLocal(entry) && (
                      <span style={{ display: "flex", gap: "var(--space-xs)" }}>
                        <button className="stratum-btn" disabled={mutating} onClick={() => handleEdit(entry)}>Edit</button>
                        <button className="stratum-btn destructive" disabled={mutating} onClick={() => handleDelete(entry.key)}>Delete</button>
                      </span>
                    )}
                  </td>
                </tr>
                {editingKey === entry.key && (
                  <tr className="stratum-edit-row">
                    <td colSpan={5}>
                      <div className="stratum-form-controls">
                        <span style={{ fontSize: "0.75rem", color: "var(--color-500)" }}>Value:</span>
                        <input className="stratum-input" style={{ width: 200 }} value={editValue} onChange={(e) => setEditValue(e.target.value)} />
                        <label style={{ fontSize: "0.75rem", color: "var(--color-500)", display: "flex", alignItems: "center", gap: "var(--space-xs)" }}>
                          <input type="checkbox" checked={editLocked} onChange={(e) => setEditLocked(e.target.checked)} />
                          Locked
                        </label>
                        <button className="stratum-btn primary" disabled={mutating} onClick={() => handleEditSubmit(entry.key)}>Save</button>
                        <button className="stratum-btn" onClick={() => setEditingKey(null)}>Cancel</button>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}

      {tenant && (
        <div className="stratum-form-row">
          <div className="stratum-form-hint">
            Add a config override for this tenant. The value is JSON-parsed (falls back to string). Locking prevents descendants from overriding.
          </div>
          <div className="stratum-form-controls">
            <input className="stratum-input" style={{ width: 140 }} placeholder="key" value={addKey} onChange={(e) => setAddKey(e.target.value)} />
            <input className="stratum-input" style={{ width: 200 }} placeholder="value (JSON or string)" value={addValue} onChange={(e) => setAddValue(e.target.value)} />
            <label style={{ fontSize: "0.75rem", color: "var(--color-500)", display: "flex", alignItems: "center", gap: "var(--space-xs)" }}>
              <input type="checkbox" checked={addLocked} onChange={(e) => setAddLocked(e.target.checked)} />
              Locked
            </label>
            <button className="stratum-btn success" disabled={mutating || !addKey.trim()} onClick={handleAdd}>Add Config</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Section: Permissions ─────────────────────────────────────────────────────

function PermissionsSection({ onStats }: { onStats?: (stats: { total: number; locked: number; delegated: number }) => void }) {
  const { tenant } = useTenant();
  const { apiCall } = useStratum();
  const [data, setData] = useState<PermissionEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    if (onStats) {
      onStats({
        total: data.length,
        locked: data.filter((d) => d.locked).length,
        delegated: data.filter((d) => d.delegated).length,
      });
    }
  }, [data, onStats]);

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

  const modeClass: Record<string, string> = {
    LOCKED: "locked",
    INHERITED: "info",
    DELEGATED: "success",
  };

  return (
    <div className="stratum-section">
      <div className="stratum-section-header">
        <span className="stratum-section-title">Permissions</span>
        <span className="stratum-section-desc">
          Permissions cascade through the tree with three delegation modes:
          LOCKED (immutable), INHERITED (overridable), and DELEGATED (overridable + re-delegatable).
        </span>
      </div>
      {loading && <div className="stratum-loading">Loading...</div>}
      {error && <div className="stratum-error">Error: {error}</div>}
      {!loading && !error && data.length === 0 && (
        <div className="stratum-empty">No permissions defined. Grant one below.</div>
      )}
      {!loading && data.length > 0 && (
        <table className="stratum-table">
          <thead>
            <tr>
              <th>Permission</th>
              <th>Value</th>
              <th>Mode</th>
              <th>Flags</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.map((perm) => (
              <tr key={perm.key}>
                <td className="stratum-mono">{perm.key}</td>
                <td>
                  <span className={`stratum-badge ${perm.value ? "success" : "error"}`}>
                    {perm.value ? "YES" : "NO"}
                  </span>
                </td>
                <td>
                  <span className={`stratum-badge ${modeClass[perm.mode] || "own"}`}>
                    {perm.mode || "\u2014"}
                  </span>
                </td>
                <td style={{ fontSize: "0.75rem" }}>
                  {perm.locked && <span style={{ color: "var(--color-error)", marginRight: 6 }}>locked</span>}
                  {perm.delegated && <span style={{ color: "var(--color-success)" }}>delegated</span>}
                  {!perm.locked && !perm.delegated && <span style={{ color: "var(--color-400)" }}>&mdash;</span>}
                </td>
                <td>
                  {tenant && perm.source_tenant_id === tenant.id && (
                    <button className="stratum-btn destructive" disabled={mutating} onClick={() => handleDelete(perm.policy_id)}>Delete</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tenant && (
        <div className="stratum-form-row">
          <div className="stratum-form-hint">
            Grant a new permission to this tenant. Mode controls how descendants can interact with it.
          </div>
          <div className="stratum-form-controls">
            <input className="stratum-input" style={{ width: 160 }} placeholder="permission.key" value={addKey} onChange={(e) => setAddKey(e.target.value)} />
            <select className="stratum-select" value={addMode} onChange={(e) => setAddMode(e.target.value)}>
              <option value="LOCKED">LOCKED</option>
              <option value="INHERITED">INHERITED</option>
              <option value="DELEGATED">DELEGATED</option>
            </select>
            <select className="stratum-select" value={addRevocationMode} onChange={(e) => setAddRevocationMode(e.target.value)}>
              <option value="CASCADE">CASCADE</option>
              <option value="SOFT">SOFT</option>
              <option value="PERMANENT">PERMANENT</option>
            </select>
            <button className="stratum-btn primary" disabled={mutating || !addKey.trim()} onClick={handleAdd}>Add Permission</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Section: Security Events ─────────────────────────────────────────────────

function SecurityEventsSection({ onStats }: { onStats?: (count: number) => void }) {
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

  useEffect(() => {
    if (onStats) onStats(events.length);
  }, [events, onStats]);

  return (
    <div className="stratum-section">
      <div className="stratum-section-header">
        <span className="stratum-section-title">Security Events -- RLS Demo</span>
        <span className="stratum-section-desc">
          Filtered by PostgreSQL Row-Level Security. The database scopes queries to the current tenant
          via <span className="stratum-mono">SET LOCAL app.current_tenant_id</span>. Switch tenants to see different events.
        </span>
      </div>
      {loading && <div className="stratum-loading">Loading...</div>}
      {error && <div className="stratum-error">Error: {error}</div>}
      {!loading && !error && (
        <table className="stratum-table">
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
                <td>
                  <span className={`stratum-badge severity-${e.severity}`}>
                    {e.severity.toUpperCase()}
                  </span>
                </td>
                <td>{e.event_type}</td>
                <td style={{ color: "var(--color-600)" }}>{e.description}</td>
                <td className="stratum-mono" style={{ color: "var(--color-500)" }}>{e.source_ip || "\u2014"}</td>
                <td style={{ color: "var(--color-400)", fontSize: "0.75rem" }}>{new Date(e.created_at).toLocaleString()}</td>
              </tr>
            ))}
            {events.length === 0 && (
              <tr>
                <td colSpan={5} className="stratum-empty">
                  No events for this tenant. Events are scoped by RLS -- switch tenants to see others.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Section: Audit Log ───────────────────────────────────────────────────────

function AuditLogSection({ onStats }: { onStats?: (count: number) => void }) {
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

  useEffect(() => {
    if (onStats) onStats(entries.length);
  }, [entries, onStats]);

  const actionColors: Record<string, string> = {
    "tenant.created": "success",
    "tenant.updated": "info",
    "tenant.deleted": "error",
    "config.updated": "inherited",
    "permission.created": "locked",
  };

  return (
    <div className="stratum-section">
      <div className="stratum-section-header">
        <span className="stratum-section-title">Audit Log</span>
        <span className="stratum-section-desc">
          Immutable audit trail. Every mutation is recorded with actor identity, resource type, and timestamp.
        </span>
      </div>
      {loading && <div className="stratum-loading">Loading...</div>}
      {error && <div className="stratum-error">Error: {error}</div>}
      {!loading && !error && (
        <table className="stratum-table">
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
                <td>
                  <span className={`stratum-badge ${actionColors[e.action] || "own"}`}>
                    {e.action}
                  </span>
                </td>
                <td className="stratum-mono" style={{ fontSize: "0.6875rem", color: "var(--color-500)" }}>
                  {e.resource_type}{e.resource_id ? ` (${e.resource_id.slice(0, 8)}...)` : ""}
                </td>
                <td className="stratum-mono" style={{ fontSize: "0.6875rem", color: "var(--color-500)" }}>
                  {e.actor_type}: {e.actor_id.slice(0, 8)}...
                </td>
                <td style={{ color: "var(--color-400)", fontSize: "0.75rem" }}>
                  {new Date(e.created_at).toLocaleString()}
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={4} className="stratum-empty">
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

function ApiKeySection({ onStats }: { onStats?: (stats: { total: number; active: number; revoked: number }) => void }) {
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

  useEffect(() => {
    if (onStats) {
      onStats({
        total: keys.length,
        active: keys.filter((k) => !k.revoked_at).length,
        revoked: keys.filter((k) => !!k.revoked_at).length,
      });
    }
  }, [keys, onStats]);

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

  return (
    <div className="stratum-section">
      <div className="stratum-section-header">
        <span className="stratum-section-title">API Keys</span>
        <span className="stratum-section-desc">
          Manage API keys for this tenant. Keys are scoped to the tenant and its descendants.
          The plaintext key is shown only once at creation.
        </span>
      </div>
      {loading && <div className="stratum-loading">Loading...</div>}
      {error && <div className="stratum-error">Error: {error}</div>}
      {createdKey && (
        <div className="stratum-key-banner">
          <strong>New key created -- copy now, it won&apos;t be shown again:</strong>
          <code>{createdKey}</code>
        </div>
      )}
      {!loading && !error && (
        <table className="stratum-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Last Used</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id}>
                <td className="stratum-mono">{k.name || "\u2014"}</td>
                <td>
                  {k.revoked_at ? (
                    <span className="stratum-badge error">REVOKED</span>
                  ) : (
                    <span className="stratum-badge success">ACTIVE</span>
                  )}
                </td>
                <td style={{ color: "var(--color-400)", fontSize: "0.75rem" }}>
                  {k.last_used_at ? new Date(k.last_used_at).toLocaleString() : "Never"}
                </td>
                <td style={{ color: "var(--color-400)", fontSize: "0.75rem" }}>
                  {new Date(k.created_at).toLocaleString()}
                </td>
                <td>
                  {!k.revoked_at && (
                    <button className="stratum-btn destructive" disabled={mutating} onClick={() => handleRevoke(k.id)}>Revoke</button>
                  )}
                </td>
              </tr>
            ))}
            {keys.length === 0 && (
              <tr>
                <td colSpan={5} className="stratum-empty">
                  No API keys for this tenant. Create one below.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {tenant && (
        <div className="stratum-form-row">
          <div className="stratum-form-controls">
            <input className="stratum-input" style={{ width: 200 }} placeholder="Key name (optional)" value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} />
            <button className="stratum-btn primary" disabled={mutating} onClick={handleCreate}>Create Key</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({
  configStats,
  permStats,
  eventCount,
  auditCount,
  keyStats,
  onSwitchTab,
}: {
  configStats: { total: number; inherited: number; locked: number };
  permStats: { total: number; locked: number; delegated: number };
  eventCount: number;
  auditCount: number;
  keyStats: { total: number; active: number; revoked: number };
  onSwitchTab: (tab: TabId) => void;
}) {
  return (
    <div className="stratum-tab-content">
      <div className="stratum-stat-cards">
        <StatCard label="Config Entries" value={configStats.total} />
        <StatCard label="Inherited Values" value={configStats.inherited} variant="accent" />
        <StatCard label="Locked Values" value={configStats.locked} variant="warning" />
        <StatCard label="Permissions" value={permStats.total} variant="primary" />
        <StatCard label="Security Events" value={eventCount} />
        <StatCard label="API Keys (Active)" value={keyStats.active} variant="success" />
      </div>

      <TenantContextSection />

      <div className="stratum-overview-grid">
        <button
          className="stratum-overview-card"
          style={{ cursor: "pointer", textAlign: "left", border: "1px solid var(--color-200)" }}
          onClick={() => onSwitchTab("config")}
        >
          <div className="stratum-overview-card-title">Config Inheritance</div>
          <div className="stratum-overview-card-value" style={{ color: "var(--color-accent)" }}>{configStats.total}</div>
          <div className="stratum-overview-card-desc">
            {configStats.inherited} inherited, {configStats.locked} locked
          </div>
        </button>

        <button
          className="stratum-overview-card"
          style={{ cursor: "pointer", textAlign: "left", border: "1px solid var(--color-200)" }}
          onClick={() => onSwitchTab("permissions")}
        >
          <div className="stratum-overview-card-title">Permissions</div>
          <div className="stratum-overview-card-value" style={{ color: "var(--color-primary)" }}>{permStats.total}</div>
          <div className="stratum-overview-card-desc">
            {permStats.locked} locked, {permStats.delegated} delegated
          </div>
        </button>

        <button
          className="stratum-overview-card"
          style={{ cursor: "pointer", textAlign: "left", border: "1px solid var(--color-200)" }}
          onClick={() => onSwitchTab("events")}
        >
          <div className="stratum-overview-card-title">Security Events</div>
          <div className="stratum-overview-card-value" style={{ color: "var(--color-900)" }}>{eventCount}</div>
          <div className="stratum-overview-card-desc">RLS-scoped events for this tenant</div>
        </button>

        <button
          className="stratum-overview-card"
          style={{ cursor: "pointer", textAlign: "left", border: "1px solid var(--color-200)" }}
          onClick={() => onSwitchTab("audit")}
        >
          <div className="stratum-overview-card-title">Audit Log</div>
          <div className="stratum-overview-card-value" style={{ color: "var(--color-900)" }}>{auditCount}</div>
          <div className="stratum-overview-card-desc">Recent mutations recorded</div>
        </button>

        <button
          className="stratum-overview-card"
          style={{ cursor: "pointer", textAlign: "left", border: "1px solid var(--color-200)" }}
          onClick={() => onSwitchTab("api-keys")}
        >
          <div className="stratum-overview-card-title">API Keys</div>
          <div className="stratum-overview-card-value" style={{ color: "var(--color-success)" }}>{keyStats.active}</div>
          <div className="stratum-overview-card-desc">
            {keyStats.total} total, {keyStats.revoked} revoked
          </div>
        </button>
      </div>
    </div>
  );
}

// ── Dashboard ────────────────────────────────────────────────────────────────

export function Dashboard() {
  const { tenant, loading } = useTenant();
  const { apiCall } = useStratum();
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [contextModal, setContextModal] = useState<{ open: boolean; data: Record<string, unknown> | null; loading: boolean }>({ open: false, data: null, loading: false });

  // Stats collected from child sections
  const [configStats, setConfigStats] = useState({ total: 0, inherited: 0, locked: 0 });
  const [permStats, setPermStats] = useState({ total: 0, locked: 0, delegated: 0 });
  const [eventCount, setEventCount] = useState(0);
  const [auditCount, setAuditCount] = useState(0);
  const [keyStats, setKeyStats] = useState({ total: 0, active: 0, revoked: 0 });

  // Reset tab on tenant switch
  useEffect(() => {
    setActiveTab("overview");
  }, [tenant?.id]);

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "var(--space-3xl)", color: "var(--color-400)", fontSize: "0.875rem", fontFamily: "var(--font-body)" }}>
        Loading tenant...
      </div>
    );
  }

  if (!tenant) {
    return (
      <div style={{ textAlign: "center", padding: "var(--space-3xl)", fontFamily: "var(--font-body)" }}>
        <div style={{ fontSize: "0.9375rem", color: "var(--color-600)", marginBottom: "var(--space-sm)", fontFamily: "var(--font-display)", fontWeight: 600 }}>
          Select a tenant from the sidebar
        </div>
        <div style={{ fontSize: "0.8125rem", color: "var(--color-400)" }}>
          Click any tenant in the hierarchy to explore its context, config inheritance, permissions, and security events.
        </div>
      </div>
    );
  }

  const renderTabContent = () => {
    switch (activeTab) {
      case "overview":
        return (
          <OverviewTab
            configStats={configStats}
            permStats={permStats}
            eventCount={eventCount}
            auditCount={auditCount}
            keyStats={keyStats}
            onSwitchTab={setActiveTab}
          />
        );
      case "config":
        return (
          <div className="stratum-tab-content" key="config">
            <div className="stratum-stat-cards">
              <StatCard label="Total Entries" value={configStats.total} />
              <StatCard label="Inherited" value={configStats.inherited} variant="accent" />
              <StatCard label="Locked" value={configStats.locked} variant="warning" />
              <StatCard label="Local Overrides" value={configStats.total - configStats.inherited} variant="primary" />
            </div>
            <ConfigInheritanceSection onStats={setConfigStats} />
          </div>
        );
      case "permissions":
        return (
          <div className="stratum-tab-content" key="permissions">
            <div className="stratum-stat-cards">
              <StatCard label="Total Policies" value={permStats.total} />
              <StatCard label="Locked" value={permStats.locked} variant="warning" />
              <StatCard label="Delegated" value={permStats.delegated} variant="success" />
            </div>
            <PermissionsSection onStats={setPermStats} />
          </div>
        );
      case "events":
        return (
          <div className="stratum-tab-content" key="events">
            <div className="stratum-stat-cards">
              <StatCard label="Total Events" value={eventCount} />
            </div>
            <SecurityEventsSection onStats={setEventCount} />
          </div>
        );
      case "audit":
        return (
          <div className="stratum-tab-content" key="audit">
            <div className="stratum-stat-cards">
              <StatCard label="Recent Entries" value={auditCount} />
            </div>
            <AuditLogSection onStats={setAuditCount} />
          </div>
        );
      case "api-keys":
        return (
          <div className="stratum-tab-content" key="api-keys">
            <div className="stratum-stat-cards">
              <StatCard label="Total Keys" value={keyStats.total} />
              <StatCard label="Active" value={keyStats.active} variant="success" />
              <StatCard label="Revoked" value={keyStats.revoked} variant="error" />
            </div>
            <ApiKeySection onStats={setKeyStats} />
          </div>
        );
    }
  };

  return (
    <>
      <style>{cssVars}</style>

      {/* Hidden data-fetching instances for overview stats */}
      {activeTab === "overview" && (
        <div style={{ display: "none" }}>
          <ConfigInheritanceSection onStats={setConfigStats} />
          <PermissionsSection onStats={setPermStats} />
          <SecurityEventsSection onStats={setEventCount} />
          <AuditLogSection onStats={setAuditCount} />
          <ApiKeySection onStats={setKeyStats} />
        </div>
      )}

      <div className="stratum-dashboard">
        {/* Breadcrumb */}
        <Breadcrumb tenantId={tenant.id} />

        {/* Header */}
        <div className="stratum-dash-header">
          <h2 className="stratum-dash-title">{tenant.name}</h2>
          <span className="stratum-dash-slug">{tenant.slug}</span>
          <span className="stratum-dash-depth">depth {tenant.depth}</span>
          <button
            className="stratum-view-as-btn"
            onClick={async () => {
              setContextModal({ open: true, data: null, loading: true });
              try {
                const ctx = await apiCall<Record<string, unknown>>(`/api/v1/tenants/${tenant.id}/context`);
                setContextModal({ open: true, data: ctx, loading: false });
              } catch {
                setContextModal({ open: false, data: null, loading: false });
              }
            }}
            title="View full resolved context: inherited config, permissions, and ancestor chain"
          >
            Resolved Context
          </button>
        </div>

        {/* Tab bar */}
        <div className="stratum-tabs" role="tablist" aria-label="Dashboard sections">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`stratum-tab${activeTab === tab.id ? " active" : ""}`}
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`panel-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="stratum-tab-icon" aria-hidden="true">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div id={`panel-${activeTab}`} role="tabpanel">
          {renderTabContent()}
        </div>
      </div>

      {/* Tenant Context Modal */}
      {contextModal.open && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 1000,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)",
          }}
          onClick={() => setContextModal({ open: false, data: null, loading: false })}
        >
          <div
            style={{
              background: "var(--color-neutral-50, #F8FAFC)",
              borderRadius: "var(--radius-xl, 12px)",
              boxShadow: "var(--shadow-xl)",
              width: "min(90vw, 720px)",
              maxHeight: "80vh",
              display: "flex", flexDirection: "column",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "var(--space-lg, 16px) var(--space-xl, 24px)",
              borderBottom: "1px solid var(--color-neutral-200, #E2E8F0)",
            }}>
              <div>
                <div style={{ fontFamily: "var(--font-display, Satoshi, sans-serif)", fontWeight: 700, fontSize: "1rem" }}>
                  Tenant Context
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--color-neutral-500, #64748B)", fontFamily: "var(--font-mono, monospace)" }}>
                  {tenant.name} &middot; {tenant.id.slice(0, 8)}...
                </div>
              </div>
              <button
                onClick={() => setContextModal({ open: false, data: null, loading: false })}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  fontSize: "1.25rem", color: "var(--color-neutral-400, #94A3B8)",
                  width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center",
                  borderRadius: "var(--radius-md, 6px)",
                }}
                aria-label="Close"
              >
                &times;
              </button>
            </div>
            <div style={{ overflow: "auto", padding: "var(--space-lg, 16px) var(--space-xl, 24px)" }}>
              {contextModal.loading ? (
                <div style={{ textAlign: "center", padding: "var(--space-xl, 24px)", color: "var(--color-neutral-400, #94A3B8)" }}>
                  Loading context...
                </div>
              ) : contextModal.data ? (
                <>
                  {/* Config section */}
                  <div style={{ marginBottom: "var(--space-xl, 24px)" }}>
                    <div style={{ fontFamily: "var(--font-display, sans-serif)", fontWeight: 600, fontSize: "0.8125rem", marginBottom: "var(--space-sm, 8px)", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-neutral-500, #64748B)" }}>
                      Resolved Config
                    </div>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid var(--color-neutral-200, #E2E8F0)" }}>
                          <th style={{ textAlign: "start", padding: "6px 12px", fontWeight: 600, color: "var(--color-neutral-500)" }}>Key</th>
                          <th style={{ textAlign: "start", padding: "6px 12px", fontWeight: 600, color: "var(--color-neutral-500)" }}>Value</th>
                          <th style={{ textAlign: "start", padding: "6px 12px", fontWeight: 600, color: "var(--color-neutral-500)" }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries((contextModal.data.config as Record<string, any>) || {}).map(([key, entry]) => (
                          <tr key={key} style={{ borderBottom: "1px solid var(--color-neutral-100, #F1F5F9)" }}>
                            <td style={{ padding: "6px 12px", fontFamily: "var(--font-mono, monospace)", fontWeight: 500 }}>{key}</td>
                            <td style={{ padding: "6px 12px", fontFamily: "var(--font-mono, monospace)", color: "var(--color-neutral-600)" }}>{JSON.stringify(entry.value)}</td>
                            <td style={{ padding: "6px 12px" }}>
                              {entry.locked ? (
                                <span style={{ background: "#FEF3C7", color: "#92400E", padding: "2px 8px", borderRadius: 9999, fontSize: "0.6875rem", fontWeight: 500 }}>{"\u2193"} Locked</span>
                              ) : entry.inherited ? (
                                <span style={{ background: "#CCFBF1", color: "#0D9488", padding: "2px 8px", borderRadius: 9999, fontSize: "0.6875rem", fontWeight: 500 }}>{"\u2191"} Inherited</span>
                              ) : (
                                <span style={{ background: "#F1F5F9", color: "#475569", padding: "2px 8px", borderRadius: 9999, fontSize: "0.6875rem", fontWeight: 500 }}>{"\u2022"} Own</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Permissions section */}
                  <div style={{ marginBottom: "var(--space-xl, 24px)" }}>
                    <div style={{ fontFamily: "var(--font-display, sans-serif)", fontWeight: 600, fontSize: "0.8125rem", marginBottom: "var(--space-sm, 8px)", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-neutral-500, #64748B)" }}>
                      Resolved Permissions
                    </div>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid var(--color-neutral-200, #E2E8F0)" }}>
                          <th style={{ textAlign: "start", padding: "6px 12px", fontWeight: 600, color: "var(--color-neutral-500)" }}>Permission</th>
                          <th style={{ textAlign: "start", padding: "6px 12px", fontWeight: 600, color: "var(--color-neutral-500)" }}>Value</th>
                          <th style={{ textAlign: "start", padding: "6px 12px", fontWeight: 600, color: "var(--color-neutral-500)" }}>Mode</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries((contextModal.data.permissions as Record<string, any>) || {}).map(([key, perm]) => (
                          <tr key={key} style={{ borderBottom: "1px solid var(--color-neutral-100, #F1F5F9)" }}>
                            <td style={{ padding: "6px 12px", fontFamily: "var(--font-mono, monospace)", fontWeight: 500 }}>{key}</td>
                            <td style={{ padding: "6px 12px" }}>
                              {perm.value ? (
                                <span style={{ color: "#059669", fontWeight: 600 }}>YES</span>
                              ) : (
                                <span style={{ color: "#DC2626", fontWeight: 600 }}>NO</span>
                              )}
                            </td>
                            <td style={{ padding: "6px 12px", fontFamily: "var(--font-mono, monospace)", fontSize: "0.6875rem", color: "var(--color-neutral-500)" }}>{perm.mode}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Ancestors section */}
                  <div>
                    <div style={{ fontFamily: "var(--font-display, sans-serif)", fontWeight: 600, fontSize: "0.8125rem", marginBottom: "var(--space-sm, 8px)", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-neutral-500, #64748B)" }}>
                      Ancestor Chain
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {((contextModal.data.ancestors as any[]) || []).map((a: any, i: number) => (
                        <span key={a.id} style={{
                          background: "var(--color-neutral-100, #F1F5F9)",
                          padding: "4px 12px", borderRadius: 9999,
                          fontSize: "0.75rem", fontFamily: "var(--font-body, sans-serif)",
                          color: "var(--color-neutral-700, #334155)",
                        }}>
                          {i > 0 && <span style={{ color: "var(--color-neutral-400)", marginInlineEnd: 4 }}>{"\u2192"}</span>}
                          {a.name}
                        </span>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
