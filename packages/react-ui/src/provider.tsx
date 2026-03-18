import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, type ReactNode } from "react";
import type { TenantNode, TenantContextLegacy, ResolvedConfig, ResolvedPermission } from "@stratum-hq/core";
import { defaultMessages, type Messages } from "./i18n.js";
import { useToast } from "./hooks/use-toast.js";
import type { UseToastReturn } from "./hooks/use-toast.js";
import { ToastContainer } from "./components/ToastContainer.js";

export interface StratumProviderProps {
  controlPlaneUrl: string;
  apiKey: string;
  initialTenantId?: string;
  /** Partial message overrides merged on top of `defaultMessages`. */
  messages?: Messages;
  children: ReactNode;
}

export interface StratumContextValue {
  currentTenant: TenantNode | null;
  tenantContext: TenantContextLegacy | null;
  loading: boolean;
  error: Error | null;
  switchTenant: (tenantId: string) => Promise<void>;
  apiCall: <T>(path: string, options?: RequestInit) => Promise<T>;
  /** Resolved messages (user overrides merged with defaults). */
  messages: Record<string, string>;
  /** Toast notification system */
  toast: UseToastReturn["toast"];
}

const StratumContext = createContext<StratumContextValue | null>(null);

/** @internal Exported for Storybook / testing mock providers. */
export { StratumContext };

export function StratumProvider({
  controlPlaneUrl,
  apiKey,
  initialTenantId,
  messages: userMessages,
  children,
}: StratumProviderProps) {
  const { toasts, toast, dismiss } = useToast();

  const [currentTenant, setCurrentTenant] = useState<TenantNode | null>(null);
  const [tenantContext, setTenantContext] = useState<TenantContextLegacy | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const mergedMessages = useMemo<Record<string, string>>(
    () => ({ ...defaultMessages, ...userMessages }),
    [userMessages],
  );

  const baseUrl = controlPlaneUrl.replace(/\/$/, "");

  const apiCall = useCallback(
    async <T,>(path: string, options?: RequestInit): Promise<T> => {
      const headers: Record<string, string> = {
        "X-API-Key": apiKey,
      };
      // Only set Content-Type for requests that have a body
      if (options?.body) {
        headers["Content-Type"] = "application/json";
      }
      const res = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: {
          ...headers,
          ...options?.headers,
        },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: { message: res.statusText } })) as { error?: { message?: string } };
        throw new Error(body.error?.message || `API error: ${res.status}`);
      }
      // 204 No Content — return empty object instead of trying to parse JSON
      if (res.status === 204) {
        return {} as T;
      }
      return res.json() as Promise<T>;
    },
    [baseUrl, apiKey],
  );

  const switchTenant = useCallback(
    async (tenantId: string) => {
      setLoading(true);
      setError(null);
      try {
        const tenant = await apiCall<TenantNode>(`/api/v1/tenants/${tenantId}`);
        const [config, permissions] = await Promise.all([
          apiCall<ResolvedConfig>(`/api/v1/tenants/${tenantId}/config`),
          apiCall<Record<string, ResolvedPermission>>(`/api/v1/tenants/${tenantId}/permissions`),
        ]);
        setCurrentTenant(tenant);
        setTenantContext({
          tenant_id: tenant.id,
          ancestry_path: tenant.ancestry_path,
          depth: tenant.depth,
          resolved_config: config as Record<string, unknown>,
          resolved_permissions: permissions,
          isolation_strategy: tenant.isolation_strategy,
        });
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        setLoading(false);
      }
    },
    [apiCall],
  );

  useEffect(() => {
    if (initialTenantId) {
      switchTenant(initialTenantId);
    }
  }, [initialTenantId, switchTenant]);

  return (
    <StratumContext.Provider
      value={{ currentTenant, tenantContext, loading, error, switchTenant, apiCall, messages: mergedMessages, toast }}
    >
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </StratumContext.Provider>
  );
}

export function useStratum(): StratumContextValue {
  const ctx = useContext(StratumContext);
  if (!ctx) {
    throw new Error("useStratum must be used within a <StratumProvider>");
  }
  return ctx;
}
