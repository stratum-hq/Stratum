import React, { useEffect, useCallback } from "react";

export type ToastType = "success" | "error" | "warning" | "info";

export interface ToastData {
  id: string;
  message: string;
  type: ToastType;
  /** The raw error text. The toast shows it only when the user opens its details. */
  detail?: string;
}

export interface ToastProps {
  /** Toast message text */
  message: string;
  /** Semantic type controlling color and behavior */
  type: ToastType;
  /**
   * Technical text for the user who needs it, such as the raw API error.
   * The toast keeps it behind a "Details" control so the message stays plain language.
   */
  detail?: string;
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
  detail,
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
    // Each toast is its own live region. An error interrupts (alert); any other
    // type waits for the screen reader to finish (status). An explicit aria-live
    // here would contradict the role.
    <div
      className={`stratum-toast ${TYPE_CLASSES[type]}`}
      role={type === "error" ? "alert" : "status"}
    >
      <div className="stratum-toast__body">
        <span className="stratum-toast__message">{message}</span>
        {detail && (
          <details className="stratum-toast__details">
            <summary>Details</summary>
            <code>{detail}</code>
          </details>
        )}
      </div>
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
