import { useState, useEffect, useCallback } from "react";
import { useTenant } from "./use-tenant.js";
import { useStratum } from "../provider.js";

export interface WebhookEntry {
  id: string;
  tenant_id: string | null;
  url: string;
  events: string[];
  active: boolean;
  secret: string;
  created_at: string;
}

export interface WebhookTestResult {
  success: boolean;
  response_code?: number;
  error?: string;
}

export function useWebhooks() {
  const { tenant } = useTenant();
  const { apiCall } = useStratum();
  const [webhooks, setWebhooks] = useState<WebhookEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    if (!tenant) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiCall<WebhookEntry[]>(`/api/v1/webhooks?tenant_id=${tenant.id}`);
      setWebhooks(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [tenant?.id, apiCall]);

  useEffect(() => { refresh(); }, [refresh]);

  const createWebhook = useCallback(async (url: string, events: string[]) => {
    if (!tenant) return;
    await apiCall("/api/v1/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenant_id: tenant.id, url, events }),
    });
    await refresh();
  }, [tenant?.id, apiCall, refresh]);

  const deleteWebhook = useCallback(async (id: string) => {
    await apiCall(`/api/v1/webhooks/${id}`, { method: "DELETE" });
    await refresh();
  }, [apiCall, refresh]);

  const testWebhook = useCallback(async (id: string): Promise<WebhookTestResult> => {
    return apiCall<WebhookTestResult>(`/api/v1/webhooks/${id}/test`, { method: "POST" });
  }, [apiCall]);

  return { webhooks, loading, error, refresh, createWebhook, deleteWebhook, testWebhook };
}
