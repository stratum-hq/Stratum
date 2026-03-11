import React, { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import type { TenantNode, TenantContext, ResolvedConfig, ResolvedPermission } from "@stratum/core";

export interface StratumProviderProps {
  controlPlaneUrl: string;
  apiKey: string;
  initialTenantId?: string;
  children: ReactNode;
}

export interface StratumContextValue {
  currentTenant: TenantNode | null;
  tenantContext: TenantContext | null;
  loading: boolean;
  error: Error | null;
  switchTenant: (tenantId: string) => Promise<void>;
  apiCall: <T>(path: string, options?: RequestInit) => Promise<T>;
}

const StratumContext = createContext<StratumContextValue | null>(null);

export function StratumProvider({
  controlPlaneUrl,
  apiKey,
  initialTenantId,
  children,
}: StratumProviderProps) {
  const [currentTenant, setCurrentTenant] = useState<TenantNode | null>(null);
  const [tenantContext, setTenantContext] = useState<TenantContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const baseUrl = controlPlaneUrl.replace(/\/$/, "");

  const apiCall = useCallback(
    async <T,>(path: string, options?: RequestInit): Promise<T> => {
      const res = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
          ...options?.headers,
        },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: { message: res.statusText } })) as { error?: { message?: string } };
        throw new Error(body.error?.message || `API error: ${res.status}`);
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
      value={{ currentTenant, tenantContext, loading, error, switchTenant, apiCall }}
    >
      {children}
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
