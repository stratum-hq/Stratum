import { useEffect, useMemo, useState } from "react";
import { useStratum } from "../provider.js";
import { useTenant } from "./use-tenant.js";

/**
 * Returns a map from tenant ID to tenant name for the current tenant and each of its ancestors.
 *
 * The current tenant or one of its ancestors sets each config value and each permission
 * policy, so this map names every source. An ancestor is absent from the map while the
 * ancestors request is pending, or when it failed.
 */
export function useAncestorNames(): Record<string, string> {
  const { apiCall } = useStratum();
  const { tenant } = useTenant();
  const [ancestorNames, setAncestorNames] = useState<Record<string, string>>({});

  // The route returns name and id even for ancestors above a tenant-scoped API key.
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
      // A missing name is not an error: the editors show the tenant ID instead.
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [apiCall, tenant?.id]);

  return useMemo(
    () => (tenant ? { ...ancestorNames, [tenant.id]: tenant.name } : ancestorNames),
    [ancestorNames, tenant?.id, tenant?.name],
  );
}
