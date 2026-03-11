import React, { useState } from "react";
import { useConfig } from "../hooks/use-config.js";

export interface ConfigEditorProps {
  className?: string;
}

export function ConfigEditor({ className }: ConfigEditorProps) {
  const { config, loading, error, setConfigValue, deleteConfigValue } = useConfig();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  if (loading) return <div className={className}>Loading config...</div>;
  if (error) return <div className={className}>Error: {error.message}</div>;

  const handleSave = async (key: string) => {
    try {
      const parsed = JSON.parse(editValue);
      await setConfigValue(key, parsed);
    } catch {
      await setConfigValue(key, editValue);
    }
    setEditingKey(null);
  };

  const handleAdd = async () => {
    if (!newKey) return;
    try {
      const parsed = JSON.parse(newValue);
      await setConfigValue(newKey, parsed);
    } catch {
      await setConfigValue(newKey, newValue);
    }
    setNewKey("");
    setNewValue("");
  };

  return (
    <div className={`stratum-config-editor ${className || ""}`}>
      <table className="stratum-config-editor__table">
        <thead>
          <tr>
            <th>Key</th>
            <th>Value</th>
            <th>Source</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {config.map((entry) => (
            <tr key={entry.key} className={entry.locked ? "stratum-config-editor__row--locked" : ""}>
              <td>{entry.key}</td>
              <td>
                {editingKey === entry.key ? (
                  <input
                    type="text"
                    value={editValue}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditValue(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSave(entry.key)}
                    aria-label={`Edit value for ${entry.key}`}
                  />
                ) : (
                  <code>{JSON.stringify(entry.value)}</code>
                )}
              </td>
              <td className="stratum-config-editor__source">
                {entry.source_tenant_id.slice(0, 8)}...
              </td>
              <td>
                {entry.locked && <span className="stratum-badge stratum-badge--locked">Locked</span>}
                {entry.inherited && !entry.locked && (
                  <span className="stratum-badge stratum-badge--inherited">Inherited</span>
                )}
                {!entry.inherited && !entry.locked && (
                  <span className="stratum-badge stratum-badge--own">Own</span>
                )}
              </td>
              <td>
                {!entry.locked && (
                  <>
                    {editingKey === entry.key ? (
                      <>
                        <button type="button" onClick={() => handleSave(entry.key)}>Save</button>
                        <button type="button" onClick={() => setEditingKey(null)}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingKey(entry.key);
                            setEditValue(JSON.stringify(entry.value));
                          }}
                        >
                          Edit
                        </button>
                        {!entry.inherited && (
                          <button type="button" onClick={() => deleteConfigValue(entry.key)}>
                            Remove
                          </button>
                        )}
                      </>
                    )}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="stratum-config-editor__add">
        <input
          type="text"
          value={newKey}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewKey(e.target.value)}
          placeholder="New key"
          aria-label="New config key"
        />
        <input
          type="text"
          value={newValue}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewValue(e.target.value)}
          placeholder="Value (JSON or string)"
          aria-label="New config value"
        />
        <button type="button" onClick={handleAdd} disabled={!newKey}>
          Add
        </button>
      </div>
    </div>
  );
}
