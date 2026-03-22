/**
 * useConfigCascade — fetches resolved config for a tenant and its children,
 * enabling a visual comparison of how config values flow down the hierarchy.
 *
 * ┌──────────────────┐       ┌──────────────────┐
 * │  Parent Config   │ ───▶  │  Child Config     │
 * │  max_users: 1000 │       │  max_users: 1000  │ ← inherited
 * │  brand_color: …  │       │  brand_color: …   │ ← own (overridden)
 * └──────────────────┘       └──────────────────┘
 */

import { useState, useEffect, useCallback } from "react";
import { useTenant } from "./use-tenant.js";
import { useStratum } from "../provider.js";

export interface CascadeConfigEntry {
  key: string;
  value: unknown;
  source_tenant_id: string;
  inherited: boolean;
  locked: boolean;
}

export interface CascadeChild {
  id: string;
  name: string;
  slug: string;
  config: CascadeConfigEntry[];
}

export interface ConfigCascadeData {
  parent: {
    id: string;
    name: string;
    slug: string;
    config: CascadeConfigEntry[];
  };
  children: CascadeChild[];
}

export function useConfigCascade() {
  const { tenant } = useTenant();
  const { apiCall } = useStratum();
  const [data, setData] = useState<ConfigCascadeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchCascade = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    setError(null);

    try {
      // Fetch parent config + children list in parallel
      const [configRes, childrenRes] = await Promise.all([
        apiCall<Record<string, CascadeConfigEntry>>(
          `/api/v1/tenants/${tenant.id}/config`,
        ),
        apiCall<Array<{ id: string; name: string; slug: string }>>(
          `/api/v1/tenants/${tenant.id}/descendants`,
        ).catch(() => [] as Array<{ id: string; name: string; slug: string }>),
      ]);

      // Transform parent config to array
      const parentConfig = Object.entries(configRes).map(
        ([key, entry]) => ({ ...entry, key }),
      );

      // Get direct children only (depth = parent.depth + 1)
      // The descendants endpoint returns all descendants, so filter to direct children
      const directChildren = Array.isArray(childrenRes)
        ? childrenRes.filter(
            (c: Record<string, unknown>) =>
              (c as { parent_id?: string }).parent_id === tenant.id ||
              (c as { depth?: number }).depth ===
                (tenant.depth ?? 0) + 1,
          )
        : [];

      // Fetch config for each direct child (limit to first 5 for performance)
      const childConfigs = await Promise.all(
        directChildren.slice(0, 5).map(async (child) => {
          try {
            const childConfig = await apiCall<
              Record<string, CascadeConfigEntry>
            >(`/api/v1/tenants/${child.id}/config`);
            return {
              id: child.id,
              name: child.name,
              slug: child.slug,
              config: Object.entries(childConfig).map(
                ([key, entry]) => ({ ...entry, key }),
              ),
            };
          } catch {
            return {
              id: child.id,
              name: child.name,
              slug: child.slug,
              config: [],
            };
          }
        }),
      );

      setData({
        parent: {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          config: parentConfig,
        },
        children: childConfigs,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err : new Error("Failed to load config cascade"),
      );
    } finally {
      setLoading(false);
    }
  }, [tenant?.id]);

  useEffect(() => {
    fetchCascade();
  }, [fetchCascade]);

  return { data, loading, error, refresh: fetchCascade };
}
