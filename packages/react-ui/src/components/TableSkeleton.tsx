import React from "react";
import { Skeleton } from "./Skeleton.js";

export interface TableSkeletonProps {
  /** Number of placeholder rows */
  rows?: number;
  /** Number of columns */
  columns?: number;
  /** Additional CSS class name */
  className?: string;
}

export function TableSkeleton({
  rows = 5,
  columns = 4,
  className,
}: TableSkeletonProps) {
  return (
    <div className={`stratum-table-skeleton ${className || ""}`} role="status" aria-label="Loading table data" aria-busy="true">
      <table className="stratum-table-skeleton__table">
        <thead>
          <tr>
            {Array.from({ length: columns }, (_, colIndex) => (
              <th key={colIndex}>
                <Skeleton variant="text" width="60%" height="0.75rem" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, rowIndex) => (
            <tr key={rowIndex}>
              {Array.from({ length: columns }, (_, colIndex) => (
                <td key={colIndex}>
                  <Skeleton
                    variant="text"
                    width={colIndex === 0 ? "70%" : colIndex === columns - 1 ? "40%" : "55%"}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
