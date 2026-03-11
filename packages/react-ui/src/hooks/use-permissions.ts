import { useState, useEffect, useCallback } from "react";
import type { ResolvedPermission } from "@stratum/core";
import { useStratum } from "../provider.js";
import { useTenant } from "./use-tenant.js";

export function usePermissions() {
  const { apiCall } = useStratum();
  const { tenant } = useTenant();
  const [permissions, setPermissions] = useState<ResolvedPermission[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchPermissions = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiCall<Record<string, ResolvedPermission>>(
        `/api/v1/tenants/${tenant.id}/permissions`,
      );
      setPermissions(Object.values(result));
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [apiCall, tenant]);

  useEffect(() => {
    fetchPermissions();
  }, [fetchPermissions]);

  const createPermission = useCallback(
    async (key: string, value: unknown, mode: string, revocationMode: string) => {
      if (!tenant) return;
      await apiCall(`/api/v1/tenants/${tenant.id}/permissions`, {
        method: "POST",
        body: JSON.stringify({ key, value, mode, revocation_mode: revocationMode }),
      });
      await fetchPermissions();
    },
    [apiCall, tenant, fetchPermissions],
  );

  const deletePermission = useCallback(
    async (policyId: string) => {
      if (!tenant) return;
      await apiCall(`/api/v1/tenants/${tenant.id}/permissions/${policyId}`, {
        method: "DELETE",
      });
      await fetchPermissions();
    },
    [apiCall, tenant, fetchPermissions],
  );

  return { permissions, loading, error, refresh: fetchPermissions, createPermission, deletePermission };
}
