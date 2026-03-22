import React, { useState } from "react";
import { useWebhooks } from "../hooks/use-webhooks.js";
import { useStratum } from "../provider.js";
import { TableSkeleton } from "./TableSkeleton.js";

export interface WebhookEditorProps {
  className?: string;
}

export function WebhookEditor({ className }: WebhookEditorProps) {
  const { webhooks, loading, error, createWebhook, deleteWebhook, testWebhook } = useWebhooks();
  const { toast } = useStratum();
  const [newUrl, setNewUrl] = useState("");
  const [newEvents, setNewEvents] = useState("tenant.created,tenant.updated,config.updated");
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string }>>({});

  if (loading) {
    return (
      <div className={`stratum-webhook-editor ${className || ""}`}>
        <TableSkeleton rows={3} columns={4} />
      </div>
    );
  }

  if (error) {
    return <div className={className}>Failed to load webhooks: {error.message}</div>;
  }

  const handleCreate = async () => {
    if (!newUrl.trim()) return;
    try {
      const events = newEvents.split(",").map((e) => e.trim()).filter(Boolean);
      await createWebhook(newUrl.trim(), events);
      toast.success("Webhook created");
      setNewUrl("");
    } catch (err) {
      toast.error(`Failed to create webhook: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteWebhook(id);
      toast.success("Webhook deleted");
    } catch (err) {
      toast.error(`Failed to delete webhook: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleTest = async (id: string) => {
    try {
      const result = await testWebhook(id);
      setTestResults((prev) => ({
        ...prev,
        [id]: {
          success: result.success,
          message: result.success ? `OK (${result.response_code})` : (result.error || "Failed"),
        },
      }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [id]: { success: false, message: err instanceof Error ? err.message : "Failed" },
      }));
    }
  };

  return (
    <div className={`stratum-webhook-editor ${className || ""}`}>
      <table className="stratum-webhook-editor__table">
        <thead>
          <tr>
            <th>URL</th>
            <th>Events</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {webhooks.map((wh) => (
            <tr key={wh.id}>
              <td><code>{wh.url}</code></td>
              <td>{wh.events.join(", ")}</td>
              <td>
                <span className={`stratum-badge stratum-badge--${wh.active ? "own" : "locked"}`}>
                  {wh.active ? "Active" : "Inactive"}
                </span>
                {testResults[wh.id] && (
                  <span className={`stratum-badge stratum-badge--${testResults[wh.id].success ? "own" : "locked"}`}>
                    {testResults[wh.id].message}
                  </span>
                )}
              </td>
              <td>
                <button type="button" onClick={() => handleTest(wh.id)}>Test</button>
                <button type="button" onClick={() => handleDelete(wh.id)}>Delete</button>
              </td>
            </tr>
          ))}
          {webhooks.length === 0 && (
            <tr>
              <td colSpan={4} style={{ textAlign: "center", padding: "16px" }}>
                No webhooks configured. Add one below.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="stratum-webhook-editor__add">
        <input
          type="url"
          value={newUrl}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewUrl(e.target.value)}
          placeholder="https://example.com/webhook"
          aria-label="Webhook URL"
        />
        <input
          type="text"
          value={newEvents}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewEvents(e.target.value)}
          placeholder="Events (comma-separated)"
          aria-label="Webhook events"
        />
        <button type="button" onClick={handleCreate} disabled={!newUrl.trim()}>
          Add Webhook
        </button>
      </div>
    </div>
  );
}
