import React from "react";

export interface EmptyStateProps {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  docsUrl?: string;
  icon?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
  docsUrl,
  icon,
  className,
}: EmptyStateProps) {
  return (
    <div className={`stratum-empty-state ${className || ""}`}>
      {icon && (
        <div className="stratum-empty-state__icon" aria-hidden="true">
          {icon}
        </div>
      )}
      <h3 className="stratum-empty-state__title">{title}</h3>
      <p className="stratum-empty-state__description">{description}</p>
      {(actionLabel || docsUrl) && (
        <div className="stratum-empty-state__actions">
          {actionLabel && onAction && (
            <button
              type="button"
              className="stratum-empty-state__action"
              onClick={onAction}
            >
              {actionLabel}
            </button>
          )}
          {docsUrl && (
            <a
              href={docsUrl}
              className="stratum-empty-state__docs"
              target="_blank"
              rel="noopener noreferrer"
            >
              Read the docs &rarr;
            </a>
          )}
        </div>
      )}
    </div>
  );
}
