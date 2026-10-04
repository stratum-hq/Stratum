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
