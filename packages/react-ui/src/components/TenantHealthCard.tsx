import React from "react";

export type TenantHealthStatus = "ok" | "override" | "missing" | "conflict";

export interface TenantHealthCardProps {
  tenantName: string;
  tenantSlug: string;
  status: TenantHealthStatus;
  overrides?: number;
  missing?: number;
  conflicts?: number;
  lastActivity?: string;
  industry?: string;
  onClick?: () => void;
  className?: string;
}

const STATUS_CLASS: Record<TenantHealthStatus, string> = {
  ok: "stratum-tenant-health-card__dot--ok",
  override: "stratum-tenant-health-card__dot--override",
  missing: "stratum-tenant-health-card__dot--missing",
  conflict: "stratum-tenant-health-card__dot--conflict",
};

export function TenantHealthCard({
  tenantName,
  tenantSlug,
  status,
  overrides,
  missing,
  conflicts,
  lastActivity,
  industry,
  onClick,
  className,
}: TenantHealthCardProps) {
  const isClickable = typeof onClick === "function";

  return (
    <div
      className={`stratum-tenant-health-card ${isClickable ? "stratum-tenant-health-card--clickable" : ""} ${className || ""}`}
      onClick={onClick}
      onKeyDown={isClickable ? (e) => e.key === "Enter" && onClick?.() : undefined}
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
    >
      <span
        className={`stratum-tenant-health-card__dot ${STATUS_CLASS[status]}`}
        aria-hidden="true"
      />
      <div className="stratum-tenant-health-card__body">
        <div className="stratum-tenant-health-card__header">
          <span className="stratum-tenant-health-card__name">{tenantName}</span>
          {industry && (
            <span className="stratum-tenant-health-card__industry">{industry}</span>
          )}
        </div>
        <span className="stratum-tenant-health-card__slug">{tenantSlug}</span>
        <div className="stratum-tenant-health-card__stats">
          {overrides !== undefined && (
            <span>{overrides} overrides</span>
          )}
          {missing !== undefined && (
            <span>{missing} missing</span>
          )}
          {conflicts !== undefined && (
            <span>{conflicts} conflicts</span>
          )}
        </div>
        {lastActivity && (
          <span className="stratum-tenant-health-card__activity">
            {lastActivity}
          </span>
        )}
      </div>
    </div>
  );
}
