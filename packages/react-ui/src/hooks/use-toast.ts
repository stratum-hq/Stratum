import { useState, useCallback, useRef } from "react";
import type { ToastType, ToastData } from "../components/Toast.js";

let toastCounter = 0;

function generateId(): string {
  toastCounter += 1;
  return `stratum-toast-${toastCounter}-${Date.now()}`;
}

export interface UseToastReturn {
  toasts: ToastData[];
  toast: {
    success: (message: string) => string;
    error: (message: string) => string;
    warning: (message: string) => string;
    info: (message: string) => string;
  };
  dismiss: (id: string) => void;
  dismissAll: () => void;
}

export function useToast(): UseToastReturn {
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const dismissAll = useCallback(() => {
    for (const timer of timersRef.current.values()) {
      clearTimeout(timer);
    }
    timersRef.current.clear();
    setToasts([]);
  }, []);

  const addToast = useCallback(
    (message: string, type: ToastType): string => {
      const id = generateId();
      const newToast: ToastData = { id, message, type };

      setToasts((prev) => [newToast, ...prev]);

      // Auto-dismiss non-error toasts after 4 seconds
      if (type !== "error") {
        const timer = setTimeout(() => {
          dismiss(id);
        }, 4000);
        timersRef.current.set(id, timer);
      }

      return id;
    },
    [dismiss],
  );

  const toast = {
    success: useCallback((message: string) => addToast(message, "success"), [addToast]),
    error: useCallback((message: string) => addToast(message, "error"), [addToast]),
    warning: useCallback((message: string) => addToast(message, "warning"), [addToast]),
    info: useCallback((message: string) => addToast(message, "info"), [addToast]),
  };

  return { toasts, toast, dismiss, dismissAll };
}
