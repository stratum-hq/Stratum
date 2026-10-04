import React from "react";
import { Toast } from "./Toast.js";
import type { ToastData } from "./Toast.js";

export interface ToastContainerProps {
  /** Array of active toasts */
  toasts: ToastData[];
  /** Called with toast ID to dismiss */
  onDismiss: (id: string) => void;
  /** Max visible toasts. Default: 3 */
  maxVisible?: number;
}

export function ToastContainer({
  toasts,
  onDismiss,
  maxVisible = 3,
}: ToastContainerProps) {
  const visibleToasts = toasts.slice(0, maxVisible);

  if (visibleToasts.length === 0) return null;

  return (
    // Each Toast carries its own live-region role. A live region on the
    // container too would make some screen readers read a toast twice.
    <div className="stratum-toast-container" role="region" aria-label="Notifications">
      {visibleToasts.map((toast) => (
        <Toast
          key={toast.id}
          message={toast.message}
          type={toast.type}
          detail={toast.detail}
          onDismiss={() => onDismiss(toast.id)}
        />
      ))}
    </div>
  );
}
