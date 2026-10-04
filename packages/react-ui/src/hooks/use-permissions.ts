import { useState, useEffect, useCallback, useMemo } from "react";
import type { ResolvedPermission } from "@stratum-hq/core";
import { useStratum } from "../provider.js";
import { useTenant } from "./use-tenant.js";
import { useAncestorNames } from "./use-ancestor-names.js";

export interface PermissionWithSource extends ResolvedPermission {
  /**
   * Name of the tenant that set the policy. Absent while the ancestors request
   * is pending, or when it failed.
   */
  source_tenant_name?: string;
}

export function usePermissions() {
  const { apiCall } = useStratum();
  const { tenant } = useTenant();
  const [permissions, setPermissions] = useState<ResolvedPermission[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const sourceNames = useAncestorNames();

  const fetchPermissions = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiCall<Record<string, ResolvedPermission>>(
        `/api/v1/tenants/${encodeURIComponent(tenant.id)}/permissions`,
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

  const namedPermissions = useMemo<PermissionWithSource[]>(
    () =>
      permissions.map((perm) => {
        const name = sourceNames[perm.source_tenant_id];
        return name ? { ...perm, source_tenant_name: name } : perm;
      }),
    [permissions, sourceNames],
  );

  const createPermission = useCallback(
    async (key: string, value: unknown, mode: string, revocationMode: string) => {
      if (!tenant) return;
      await apiCall(`/api/v1/tenants/${encodeURIComponent(tenant.id)}/permissions`, {
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
      await apiCall(`/api/v1/tenants/${encodeURIComponent(tenant.id)}/permissions/${encodeURIComponent(policyId)}`, {
        method: "DELETE",
      });
      await fetchPermissions();
    },
    [apiCall, tenant, fetchPermissions],
  );

  return { permissions: namedPermissions, loading, error, refresh: fetchPermissions, createPermission, deletePermission };
}
