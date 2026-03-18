import React, { useEffect, useCallback } from "react";

export type ToastType = "success" | "error" | "warning" | "info";

export interface ToastData {
  id: string;
  message: string;
  type: ToastType;
}

export interface ToastProps {
  /** Toast message text */
  message: string;
  /** Semantic type controlling color and behavior */
  type: ToastType;
  /** Called when toast should be removed */
  onDismiss: () => void;
  /** Auto-dismiss delay in ms. Set to 0 to disable. Error toasts never auto-dismiss. Default: 4000 */
  autoDismiss?: number;
}

const TYPE_CLASSES: Record<ToastType, string> = {
  success: "stratum-toast--success",
  error: "stratum-toast--error",
  warning: "stratum-toast--warning",
  info: "stratum-toast--info",
};

export function Toast({
  message,
  type,
  onDismiss,
  autoDismiss = 4000,
}: ToastProps) {
  const handleDismiss = useCallback(() => {
    onDismiss();
  }, [onDismiss]);

  useEffect(() => {
    // Error toasts never auto-dismiss
    if (type === "error" || autoDismiss === 0) return;

    const timer = setTimeout(handleDismiss, autoDismiss);
    return () => clearTimeout(timer);
  }, [type, autoDismiss, handleDismiss]);

  return (
    <div
      className={`stratum-toast ${TYPE_CLASSES[type]}`}
      role="alert"
      aria-live="polite"
    >
      <span className="stratum-toast__message">{message}</span>
      <button
        type="button"
        className="stratum-toast__dismiss"
        onClick={handleDismiss}
        aria-label="Dismiss notification"
      >
        &times;
      </button>
    </div>
  );
}
