import { useState, useEffect, useCallback } from "react";
import type { ResolvedConfigEntry } from "@stratum-hq/core";
import { useStratum } from "../provider.js";
import { useTenant } from "./use-tenant.js";

export interface ConfigWithInheritance {
  key: string;
  value: unknown;
  source_tenant_id: string;
  inherited: boolean;
  locked: boolean;
}

export function useConfig() {
  const { apiCall } = useStratum();
  const { tenant } = useTenant();
  const [config, setConfig] = useState<ConfigWithInheritance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchConfig = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiCall<Record<string, ResolvedConfigEntry>>(
        `/api/v1/tenants/${tenant.id}/config`,
      );
      setConfig(
        Object.entries(result).map(([key, entry]) => ({
          key,
          value: entry.value,
          source_tenant_id: entry.source_tenant_id,
          inherited: entry.inherited,
          locked: entry.locked,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [apiCall, tenant]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const setConfigValue = useCallback(
    async (key: string, value: unknown, locked = false) => {
      if (!tenant) return;
      await apiCall(`/api/v1/tenants/${tenant.id}/config/${key}`, {
        method: "PUT",
        body: JSON.stringify({ value, locked }),
      });
      await fetchConfig();
    },
    [apiCall, tenant, fetchConfig],
  );

  const deleteConfigValue = useCallback(
    async (key: string) => {
      if (!tenant) return;
      await apiCall(`/api/v1/tenants/${tenant.id}/config/${key}`, {
        method: "DELETE",
      });
      await fetchConfig();
    },
    [apiCall, tenant, fetchConfig],
  );

  return { config, loading, error, refresh: fetchConfig, setConfigValue, deleteConfigValue };
}
