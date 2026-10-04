import { useState, useEffect, useCallback, useMemo } from "react";
import type { ResolvedConfigEntry } from "@stratum-hq/core";
import { useStratum } from "../provider.js";
import { useTenant } from "./use-tenant.js";

export interface ConfigWithInheritance {
  key: string;
  value: unknown;
  source_tenant_id: string;
  inherited: boolean;
  locked: boolean;
  /** True when a sensitive value inherited from an ancestor was withheld by the API. */
  masked?: boolean;
  /**
   * Name of the tenant that set the value. Absent while the ancestors request
   * is pending, or when it failed.
   */
  source_tenant_name?: string;
}

export function useConfig() {
  const { apiCall } = useStratum();
  const { tenant } = useTenant();
  const [config, setConfig] = useState<ConfigWithInheritance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [ancestorNames, setAncestorNames] = useState<Record<string, string>>({});

  const fetchConfig = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiCall<Record<string, ResolvedConfigEntry>>(
        `/api/v1/tenants/${encodeURIComponent(tenant.id)}/config`,
      );
      setConfig(
        Object.entries(result).map(([key, entry]) => ({
          key,
          value: entry.value,
          source_tenant_id: entry.source_tenant_id,
          inherited: entry.inherited,
          locked: entry.locked,
          ...(entry.masked ? { masked: true } : {}),
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

  // A value is set by the tenant itself or by one of its ancestors, so one
  // ancestors request names every source. The route returns name and id even
  // for ancestors above a tenant-scoped API key.
  useEffect(() => {
    setAncestorNames({});
    if (!tenant) return;
    let current = true;
    apiCall<Array<{ id: string; name: string }>>(`/api/v1/tenants/${encodeURIComponent(tenant.id)}/ancestors`)
      .then((rows) => {
        if (current && Array.isArray(rows)) {
          setAncestorNames(Object.fromEntries(rows.map((row) => [row.id, row.name])));
        }
      })
      // A missing name is not an error: the editor shows the tenant ID instead.
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [apiCall, tenant?.id]);

  const namedConfig = useMemo(
    () =>
      config.map((entry) => {
        const name = entry.source_tenant_id === tenant?.id ? tenant?.name : ancestorNames[entry.source_tenant_id];
        return name ? { ...entry, source_tenant_name: name } : entry;
      }),
    [config, ancestorNames, tenant?.id, tenant?.name],
  );

  const setConfigValue = useCallback(
    async (key: string, value: unknown, locked = false) => {
      if (!tenant) return;
      await apiCall(`/api/v1/tenants/${encodeURIComponent(tenant.id)}/config/${encodeURIComponent(key)}`, {
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
      await apiCall(`/api/v1/tenants/${encodeURIComponent(tenant.id)}/config/${encodeURIComponent(key)}`, {
        method: "DELETE",
      });
      await fetchConfig();
    },
    [apiCall, tenant, fetchConfig],
  );

  return { config: namedConfig, loading, error, refresh: fetchConfig, setConfigValue, deleteConfigValue };
}
