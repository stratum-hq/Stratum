import React, { useState } from "react";
import { usePermissions } from "../hooks/use-permissions.js";

export interface PermissionEditorProps {
  className?: string;
}

const MODES = ["LOCKED", "INHERITED", "DELEGATED"] as const;
const REVOCATION_MODES = ["CASCADE", "SOFT", "PERMANENT"] as const;

export function PermissionEditor({ className }: PermissionEditorProps) {
  const { permissions, loading, error, createPermission, deletePermission } = usePermissions();
  const [newKey, setNewKey] = useState("");
  const [newMode, setNewMode] = useState<string>("INHERITED");
  const [newRevocationMode, setNewRevocationMode] = useState<string>("CASCADE");

  if (loading) return <div className={className}>Loading permissions...</div>;
  if (error) return <div className={className}>Error: {error.message}</div>;

  const handleAdd = async () => {
    if (!newKey) return;
    await createPermission(newKey, true, newMode, newRevocationMode);
    setNewKey("");
    setNewMode("INHERITED");
    setNewRevocationMode("CASCADE");
  };

  return (
    <div className={`stratum-permission-editor ${className || ""}`}>
      <table className="stratum-permission-editor__table">
        <thead>
          <tr>
            <th>Key</th>
            <th>Value</th>
            <th>Mode</th>
            <th>Source</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {permissions.map((perm) => (
            <tr key={perm.key}>
              <td>{perm.key}</td>
              <td><code>{JSON.stringify(perm.value)}</code></td>
              <td>
                <span className={`stratum-badge stratum-badge--${perm.mode.toLowerCase()}`}>
                  {perm.mode}
                </span>
              </td>
              <td className="stratum-permission-editor__source">
                {perm.source_tenant_id.slice(0, 8)}...
              </td>
              <td>
                {perm.locked && <span className="stratum-badge stratum-badge--locked">Locked</span>}
                {perm.delegated && <span className="stratum-badge stratum-badge--delegated">Delegated</span>}
              </td>
              <td>
                {!perm.locked && (
                  <button type="button" onClick={() => deletePermission(perm.source_tenant_id)}>
                    Remove
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="stratum-permission-editor__add">
        <input
          type="text"
          value={newKey}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewKey(e.target.value)}
          placeholder="Permission key"
          aria-label="New permission key"
        />
        <select
          value={newMode}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setNewMode(e.target.value)}
          aria-label="Permission mode"
        >
          {MODES.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <select
          value={newRevocationMode}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setNewRevocationMode(e.target.value)}
          aria-label="Revocation mode"
        >
          {REVOCATION_MODES.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <button type="button" onClick={handleAdd} disabled={!newKey}>
          Add
        </button>
      </div>
    </div>
  );
}
