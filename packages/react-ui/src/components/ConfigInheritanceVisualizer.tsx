/**
 * ConfigInheritanceVisualizer: shows how config values cascade from
 * parent to children with real-time visual feedback.
 *
 * ┌─────────────────────────┐     ┌─────────────────────────┐
 * │  Parent: AcmeSec        │     │  Child: NorthStar MSP    │
 * │ ─────────────────────── │ ──▶ │ ─────────────────────── │
 * │  max_users     1000     │     │  max_users     500  own │
 * │  api_rate      10000 🔒 │     │  api_rate      10000 ↑  │
 * │  brand_color   teal     │     │  brand_color   navy     │
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
    inherited: { label: "Inherited", icon: "\u2193", className: "stratum-cascade-badge--inherited" },
    locked: { label: "Locked", icon: "\u25A0", className: "stratum-cascade-badge--locked" },
    own: { label: "Own", icon: "\u25B3", className: "stratum-cascade-badge--own" },
  };
  const s = styles[type];
  return (
    <span className={`stratum-cascade-badge ${s.className}`}>
      <span aria-hidden="true">{s.icon}</span> {s.label}
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
              className={[
                highlightKey === entry.key ? "stratum-cascade-row--highlight" : "",
                entry.locked ? "stratum-cascade-row--locked" : "",
              ].filter(Boolean).join(" ")}
            >
              <td className="stratum-cascade-key">{entry.key}</td>
              <td className="stratum-cascade-value">
                {entry.masked ? (
                  <span className="stratum-cascade-masked">Sensitive value set by an ancestor</span>
                ) : (
                  <code>{JSON.stringify(entry.value)}</code>
                )}
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
  font-family: var(--font-body);
}

.stratum-cascade--error {
  padding: var(--space-xl);
  color: var(--accent-text);
  font-size: 0.875rem;
}

.stratum-cascade-retry {
  margin-top: var(--space-sm);
}

/* Child selector tabs */
.stratum-cascade-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--rule);
  margin-bottom: var(--space-lg);
  overflow-x: auto;
}

.stratum-cascade-tab {
  padding: var(--space-sm) var(--space-lg);
  font-family: var(--font-display);
  font-size: 0.9375rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  border-bottom: 3px solid transparent;
  cursor: pointer;
  white-space: nowrap;
}

.stratum-cascade-tab:hover {
  color: var(--text-primary);
}

.stratum-cascade-tab.active {
  color: var(--text-primary);
  border-bottom-color: var(--flow);
}

/* Split-screen layout */
.stratum-cascade-split {
  display: flex;
  gap: var(--space-md);
  align-items: flex-start;
}

/* Cascade arrow: the flow line, in vein */
.stratum-cascade-arrow {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-3xl) 0;
  flex-shrink: 0;
  color: var(--flow);
}

.stratum-cascade-arrow__line {
  width: 3px;
  height: 24px;
  background: var(--flow);
}

.stratum-cascade-arrow__head {
  font-size: 0.75rem;
  transform: rotate(0deg);
}

/* Panel (each side of the split) is a Layer; see default.css. */
.stratum-cascade-panel {
  flex: 1;
  min-width: 0;
  padding-top: 7px;
}

.stratum-cascade-panel--empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 200px;
}

.stratum-cascade-panel__header {
  padding: var(--space-sm) var(--space-md);
  border-bottom: 2px solid var(--rule);
  display: flex;
  align-items: baseline;
  gap: var(--space-sm);
}

.stratum-cascade-panel__title {
  font-family: var(--font-display);
  font-size: 1.25rem;
  font-weight: 900;
  line-height: 1;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--text-primary);
}

.stratum-cascade-panel__subtitle {
  font-family: var(--font-mono);
  font-size: 0.625rem;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.14em;
}

.stratum-cascade-empty-message {
  padding: var(--space-xl);
  text-align: center;
  color: var(--text-secondary);
  font-size: 0.8125rem;
}

/* Config table within panel */
.stratum-cascade-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.75rem;
}

.stratum-cascade-table th {
  padding: var(--space-xs) var(--space-md);
  text-align: left;
  font-weight: 600;
  font-size: 0.625rem;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border);
  font-family: var(--font-mono);
}

.stratum-cascade-table td {
  padding: var(--space-xs) var(--space-md);
  border-bottom: 1px solid var(--border);
  color: var(--text-primary);
}

.stratum-cascade-key {
  font-family: var(--font-mono);
  font-weight: 500;
}

.stratum-cascade-value code {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  color: var(--text-secondary);
}

.stratum-cascade-empty {
  text-align: center;
  color: var(--text-secondary);
  padding: var(--space-lg) !important;
  font-style: italic;
}

/* LOCKED rows: magma family, with the word LOCKED in the badge. */
.stratum-cascade-row--locked {
  background: var(--lock-muted);
  box-shadow: inset 4px 0 0 var(--lock);
}

/* Highlight row on hover from diff summary: the resolved flow, in vein. */
.stratum-cascade-row--highlight {
  background: var(--flow-muted);
  box-shadow: inset 4px 0 0 var(--flow);
}

/* Badges: Tag shape and type come from default.css. */
.stratum-cascade-badge--inherited,
.stratum-cascade-diff__stat--inherited {
  color: var(--on-flow);
  background: var(--flow);
}

.stratum-cascade-badge--locked,
.stratum-cascade-diff__stat--locked {
  color: var(--on-accent);
  background: var(--lock);
}

.stratum-cascade-badge--own,
.stratum-cascade-diff__stat--own {
  color: var(--surface-0);
  background: var(--text-primary);
}

/* Diff summary bar */
.stratum-cascade-diff {
  margin-top: var(--space-lg);
  padding: var(--space-sm) var(--space-md);
  border-top: 2px solid var(--rule);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-md);
  font-size: 0.75rem;
}

.stratum-cascade-diff__label {
  font-family: var(--font-mono);
  font-size: 0.625rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-secondary);
  font-weight: 600;
}

.stratum-cascade-diff__stat {
  cursor: default;
}

/* Responsive: stack on narrow screens */
@media (max-width: 768px) {
  .stratum-cascade-split {
    flex-direction: column;
    align-items: stretch;
  }

  .stratum-cascade-arrow {
    flex-direction: row;
    padding: 0 var(--space-xl);
  }

  .stratum-cascade-arrow__line {
    width: 24px;
    height: 3px;
  }

  .stratum-cascade-arrow__head {
    transform: rotate(90deg);
  }
}
`;
