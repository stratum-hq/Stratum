import { useState, useEffect, useCallback } from "react";
import { useTenant } from "./use-tenant.js";
import { useStratum } from "../provider.js";

export interface AuditEntry {
  id: string;
  tenant_id: string | null;
  actor: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  ip: string | null;
  request_id: string | null;
  created_at: string;
}

export function useAuditLogs(limit: number = 20) {
  const { tenant } = useTenant();
  const { apiCall } = useStratum();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiCall<AuditEntry[]>(
        `/api/v1/audit-logs?tenant_id=${tenant.id}&limit=${limit}`,
      );
      setEntries(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [tenant?.id, apiCall, limit]);

  useEffect(() => { refresh(); }, [refresh]);

  return { entries, loading, error, refresh };
}
