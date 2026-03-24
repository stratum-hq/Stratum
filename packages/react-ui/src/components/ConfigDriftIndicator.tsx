import React from "react";

export type ConfigDriftStatus = "ok" | "override" | "missing" | "conflict";

export interface ConfigDriftIndicatorProps {
  status: ConfigDriftStatus;
  label?: string;
  size?: "sm" | "md";
  className?: string;
}

const DEFAULT_LABELS: Record<ConfigDriftStatus, string> = {
  ok: "Compliant",
  override: "Overrides",
  missing: "Missing configs",
  conflict: "Conflicts",
};

const STATUS_DOT_CLASS: Record<ConfigDriftStatus, string> = {
  ok: "stratum-config-drift-indicator__dot--ok",
  override: "stratum-config-drift-indicator__dot--override",
  missing: "stratum-config-drift-indicator__dot--missing",
  conflict: "stratum-config-drift-indicator__dot--conflict",
};

const STATUS_BADGE_CLASS: Record<ConfigDriftStatus, string> = {
  ok: "stratum-config-drift-indicator--ok",
  override: "stratum-config-drift-indicator--override",
  missing: "stratum-config-drift-indicator--missing",
  conflict: "stratum-config-drift-indicator--conflict",
};

export function ConfigDriftIndicator({
  status,
  label,
  size = "md",
  className,
}: ConfigDriftIndicatorProps) {
  const displayLabel = label ?? DEFAULT_LABELS[status];

  return (
    <span
      className={`stratum-config-drift-indicator stratum-config-drift-indicator--${size} ${STATUS_BADGE_CLASS[status]} ${className || ""}`}
    >
      <span
        className={`stratum-config-drift-indicator__dot ${STATUS_DOT_CLASS[status]}`}
        aria-hidden="true"
      />
      {displayLabel}
    </span>
  );
}
