/**
 * ConfigInheritanceVisualizer — shows how config values cascade from
 * parent to children with real-time visual feedback.
 *
 * ┌─────────────────────────┐     ┌─────────────────────────┐
 * │  Parent: AcmeSec        │     │  Child: NorthStar MSP    │
 * │ ─────────────────────── │ ──▶ │ ─────────────────────── │
 * │  max_users     1000     │     │  max_users     500  own │
 * │  api_rate      10000 🔒 │     │  api_rate      10000 ↑  │
 * │  brand_color   #2563EB  │     │  brand_color   #1E40AF  │
 * └─────────────────────────┘     └─────────────────────────┘
 */

import React, { useState } from "react";
import { useConfigCascade } from "../hooks/use-config-cascade.js";
import type { CascadeChild, CascadeConfigEntry } from "../hooks/use-config-cascade.js";
import { TableSkeleton } from "./TableSkeleton.js";

export interface ConfigInheritanceVisualizerProps {
  className?: string;
}

function Badge({ type }: { type: "inherited" | "locked" | "own" }) {
  const styles: Record<string, { label: string; icon: string; className: string }> = {
    inherited: { label: "Inherited", icon: "\u2191", className: "stratum-cascade-badge--inherited" },
    locked: { label: "Locked", icon: "\u2193", className: "stratum-cascade-badge--locked" },
    own: { label: "Own", icon: "\u2022", className: "stratum-cascade-badge--own" },
  };
  const s = styles[type];
  return (
    <span className={`stratum-cascade-badge ${s.className}`}>
      {s.icon} {s.label}
    </span>
  );
}

function getBadgeType(entry: CascadeConfigEntry): "inherited" | "locked" | "own" {
  if (entry.locked) return "locked";
  if (entry.inherited) return "inherited";
  return "own";
}

function ConfigTable({
  entries,
  title,
  subtitle,
  highlightKey,
}: {
  entries: CascadeConfigEntry[];
  title: string;
  subtitle?: string;
  highlightKey?: string | null;
}) {
  return (
    <div className="stratum-cascade-panel">
      <div className="stratum-cascade-panel__header">
        <span className="stratum-cascade-panel__title">{title}</span>
        {subtitle && <span className="stratum-cascade-panel__subtitle">{subtitle}</span>}
      </div>
      <table className="stratum-cascade-table">
        <thead>
          <tr>
            <th>Key</th>
            <th>Value</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr
              key={entry.key}
              className={highlightKey === entry.key ? "stratum-cascade-row--highlight" : ""}
            >
              <td className="stratum-cascade-key">{entry.key}</td>
              <td className="stratum-cascade-value">
                <code>{JSON.stringify(entry.value)}</code>
              </td>
              <td>
                <Badge type={getBadgeType(entry)} />
              </td>
            </tr>
          ))}
          {entries.length === 0 && (
            <tr>
              <td colSpan={3} className="stratum-cascade-empty">
                No config values
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function ConfigInheritanceVisualizer({ className }: ConfigInheritanceVisualizerProps) {
  const { data, loading, error, refresh } = useConfigCascade();
  const [selectedChild, setSelectedChild] = useState<number>(0);
  const [highlightKey, setHighlightKey] = useState<string | null>(null);

  if (loading) {
    return (
      <div className={`stratum-cascade ${className || ""}`}>
        <TableSkeleton rows={4} columns={3} />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`stratum-cascade stratum-cascade--error ${className || ""}`}>
        <p>Failed to load inheritance data: {error.message}</p>
        <button type="button" onClick={refresh} className="stratum-cascade-retry">
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const activeChild: CascadeChild | undefined = data.children[selectedChild];

  return (
    <div className={`stratum-cascade ${className || ""}`}>
      <style>{cascadeStyles}</style>

      {/* Child selector tabs (if multiple children) */}
      {data.children.length > 1 && (
        <div className="stratum-cascade-tabs" role="tablist">
          {data.children.map((child, i) => (
            <button
              key={child.id}
              role="tab"
              aria-selected={i === selectedChild}
              className={`stratum-cascade-tab${i === selectedChild ? " active" : ""}`}
              onClick={() => { setSelectedChild(i); setHighlightKey(null); }}
            >
              {child.name}
            </button>
          ))}
        </div>
      )}

      {/* Split-screen comparison */}
      <div className="stratum-cascade-split">
        <ConfigTable
          entries={data.parent.config}
          title={data.parent.name}
          subtitle="Parent"
          highlightKey={highlightKey}
        />

        {/* Cascade arrow */}
        <div className="stratum-cascade-arrow" aria-hidden="true">
          <div className="stratum-cascade-arrow__line" />
          <div className="stratum-cascade-arrow__head">{"\u25B6"}</div>
        </div>

        {activeChild ? (
          <ConfigTable
            entries={activeChild.config}
            title={activeChild.name}
            subtitle="Child"
            highlightKey={highlightKey}
          />
        ) : (
          <div className="stratum-cascade-panel stratum-cascade-panel--empty">
            <div className="stratum-cascade-panel__header">
              <span className="stratum-cascade-panel__title">No children</span>
            </div>
            <p className="stratum-cascade-empty-message">
              This tenant has no child tenants. Create a child tenant to see
              config inheritance in action.
            </p>
          </div>
        )}
      </div>

      {/* Diff summary */}
      {activeChild && (
        <div className="stratum-cascade-diff">
          <span className="stratum-cascade-diff__label">Inheritance summary:</span>
          {(() => {
            const inherited = activeChild.config.filter((e) => e.inherited && !e.locked).length;
            const locked = activeChild.config.filter((e) => e.locked).length;
            const own = activeChild.config.filter((e) => !e.inherited && !e.locked).length;
            return (
              <>
                {inherited > 0 && (
                  <span
                    className="stratum-cascade-diff__stat stratum-cascade-diff__stat--inherited"
                    onMouseEnter={() => {
                      const firstInherited = activeChild.config.find(
                        (e) => e.inherited && !e.locked,
                      );
                      if (firstInherited) setHighlightKey(firstInherited.key);
                    }}
                    onMouseLeave={() => setHighlightKey(null)}
                  >
                    {inherited} inherited
                  </span>
                )}
                {locked > 0 && (
                  <span className="stratum-cascade-diff__stat stratum-cascade-diff__stat--locked">
                    {locked} locked
                  </span>
                )}
                {own > 0 && (
                  <span className="stratum-cascade-diff__stat stratum-cascade-diff__stat--own">
                    {own} overridden
                  </span>
                )}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ── Scoped styles ─────────────────────────────────────────────

const cascadeStyles = `
.stratum-cascade {
  font-family: var(--font-body, 'DM Sans', system-ui, sans-serif);
}

.stratum-cascade--error {
  padding: var(--space-xl, 24px);
  color: var(--color-error, #DC2626);
  font-size: 0.875rem;
}

.stratum-cascade-retry {
  margin-top: var(--space-sm, 8px);
  padding: var(--space-xs, 4px) var(--space-md, 12px);
  border: 1px solid var(--border, #E2E8F0);
  border-radius: var(--radius-sm, 4px);
  background: var(--bg-card, white);
  color: var(--text-secondary, #475569);
  cursor: pointer;
  font-size: 0.75rem;
}

/* Child selector tabs */
.stratum-cascade-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--border, #E2E8F0);
  margin-bottom: var(--space-lg, 16px);
  overflow-x: auto;
}

.stratum-cascade-tab {
  padding: var(--space-sm, 8px) var(--space-lg, 16px);
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-tertiary, #64748B);
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  font-family: var(--font-body, 'DM Sans', system-ui, sans-serif);
  white-space: nowrap;
}

.stratum-cascade-tab:hover {
  color: var(--text-primary, #0F172A);
}

.stratum-cascade-tab.active {
  color: var(--color-accent, #0D9488);
  border-bottom-color: var(--color-accent, #0D9488);
}

/* Split-screen layout */
.stratum-cascade-split {
  display: flex;
  gap: var(--space-md, 12px);
  align-items: flex-start;
}

/* Cascade arrow */
.stratum-cascade-arrow {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-3xl, 48px) 0;
  flex-shrink: 0;
  color: var(--color-accent, #0D9488);
  opacity: 0.6;
}

.stratum-cascade-arrow__line {
  width: 2px;
  height: 24px;
  background: var(--color-accent, #0D9488);
  opacity: 0.4;
}

.stratum-cascade-arrow__head {
  font-size: 0.75rem;
  transform: rotate(0deg);
}

/* Panel (each side of the split) */
.stratum-cascade-panel {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--border, #E2E8F0);
  border-radius: var(--radius-md, 6px);
  overflow: hidden;
}

.stratum-cascade-panel--empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 200px;
}

.stratum-cascade-panel__header {
  padding: var(--space-sm, 8px) var(--space-md, 12px);
  border-bottom: 1px solid var(--border, #E2E8F0);
  background: var(--bg-card, white);
  display: flex;
  align-items: baseline;
  gap: var(--space-sm, 8px);
}

.stratum-cascade-panel__title {
  font-size: 0.8125rem;
  font-weight: 700;
  color: var(--text-primary, #0F172A);
  font-family: var(--font-display, 'Satoshi', sans-serif);
}

.stratum-cascade-panel__subtitle {
  font-size: 0.6875rem;
  color: var(--text-tertiary, #64748B);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.stratum-cascade-empty-message {
  padding: var(--space-xl, 24px);
  text-align: center;
  color: var(--text-tertiary, #64748B);
  font-size: 0.8125rem;
}

/* Config table within panel */
.stratum-cascade-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.75rem;
}

.stratum-cascade-table th {
  padding: var(--space-xs, 4px) var(--space-md, 12px);
  text-align: left;
  font-weight: 600;
  font-size: 0.625rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-tertiary, #64748B);
  border-bottom: 1px solid var(--border, #E2E8F0);
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
}

.stratum-cascade-table td {
  padding: var(--space-xs, 4px) var(--space-md, 12px);
  border-bottom: 1px solid var(--border, #E2E8F0);
  color: var(--text-primary, #0F172A);
}

.stratum-cascade-key {
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-weight: 500;
}

.stratum-cascade-value code {
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-size: 0.6875rem;
  color: var(--text-secondary, #475569);
}

.stratum-cascade-empty {
  text-align: center;
  color: var(--text-tertiary, #64748B);
  padding: var(--space-lg, 16px) !important;
  font-style: italic;
}

/* Highlight row on hover from diff summary */
.stratum-cascade-row--highlight {
  background: rgba(13, 148, 136, 0.08);
}

/* Badges */
.stratum-cascade-badge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 0.625rem;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 9999px;
  white-space: nowrap;
}

.stratum-cascade-badge--inherited {
  color: var(--color-accent, #0D9488);
  background: var(--color-accent-light, #CCFBF1);
}

.stratum-cascade-badge--locked {
  color: var(--color-warning, #D97706);
  background: var(--color-warning-bg, #FEF3C7);
}

.stratum-cascade-badge--own {
  color: var(--text-secondary, #475569);
  background: var(--bg-input, var(--color-100, #F1F5F9));
  border: 1px solid var(--border, #E2E8F0);
}

/* Dark mode overrides */
[data-theme="dark"] .stratum-cascade-badge--inherited {
  background: rgba(13, 148, 136, 0.15);
}

[data-theme="dark"] .stratum-cascade-badge--locked {
  background: rgba(217, 119, 6, 0.15);
}

/* Diff summary bar */
.stratum-cascade-diff {
  margin-top: var(--space-md, 12px);
  padding: var(--space-sm, 8px) var(--space-md, 12px);
  border: 1px solid var(--border, #E2E8F0);
  border-radius: var(--radius-sm, 4px);
  display: flex;
  align-items: center;
  gap: var(--space-md, 12px);
  font-size: 0.75rem;
  background: var(--bg-card, white);
}

.stratum-cascade-diff__label {
  color: var(--text-tertiary, #64748B);
  font-weight: 500;
}

.stratum-cascade-diff__stat {
  padding: 2px 8px;
  border-radius: 9999px;
  font-weight: 600;
  font-size: 0.6875rem;
  cursor: default;
}

.stratum-cascade-diff__stat--inherited {
  color: var(--color-accent, #0D9488);
  background: var(--color-accent-light, #CCFBF1);
}

.stratum-cascade-diff__stat--locked {
  color: var(--color-warning, #D97706);
  background: var(--color-warning-bg, #FEF3C7);
}

.stratum-cascade-diff__stat--own {
  color: var(--text-secondary, #475569);
  background: var(--bg-input, var(--color-100, #F1F5F9));
}

[data-theme="dark"] .stratum-cascade-diff__stat--inherited {
  background: rgba(13, 148, 136, 0.15);
}

[data-theme="dark"] .stratum-cascade-diff__stat--locked {
  background: rgba(217, 119, 6, 0.15);
}

/* Responsive: stack on narrow screens */
@media (max-width: 768px) {
  .stratum-cascade-split {
    flex-direction: column;
  }

  .stratum-cascade-arrow {
    flex-direction: row;
    padding: 0 var(--space-xl, 24px);
  }

  .stratum-cascade-arrow__line {
    width: 24px;
    height: 2px;
  }

  .stratum-cascade-arrow__head {
    transform: rotate(90deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .stratum-cascade-row--highlight {
    transition: none;
  }
}
`;
