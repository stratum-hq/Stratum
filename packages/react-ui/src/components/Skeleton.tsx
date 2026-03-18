import React from "react";

export interface SkeletonProps {
  /** Width of the skeleton element (CSS value) */
  width?: string;
  /** Height of the skeleton element (CSS value) */
  height?: string;
  /** Shape variant */
  variant?: "text" | "rect" | "circle";
  /** Number of skeleton elements to render */
  count?: number;
  /** Additional CSS class name */
  className?: string;
}

export function Skeleton({
  width,
  height,
  variant = "text",
  count = 1,
  className,
}: SkeletonProps) {
  const variantStyles: React.CSSProperties = {
    text: {
      width: width || "100%",
      height: height || "0.8125rem",
      borderRadius: "var(--radius-sm, 4px)",
    },
    rect: {
      width: width || "100%",
      height: height || "48px",
      borderRadius: "var(--radius-sm, 4px)",
    },
    circle: {
      width: width || "40px",
      height: height || "40px",
      borderRadius: "var(--radius-full, 9999px)",
    },
  }[variant];

  const elements = Array.from({ length: count }, (_, i) => (
    <div
      key={i}
      className={`stratum-skeleton stratum-skeleton--${variant} ${className || ""}`}
      style={variantStyles}
      role="status"
      aria-label="Loading"
      aria-busy="true"
    />
  ));

  if (count === 1) return elements[0]!;

  return (
    <div className="stratum-skeleton__group" style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm, 8px)" }}>
      {elements}
    </div>
  );
}
