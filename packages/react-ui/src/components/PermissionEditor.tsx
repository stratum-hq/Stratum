import React, { useState } from "react";
import { usePermissions } from "../hooks/use-permissions.js";
import { useMessages } from "../hooks/use-messages.js";
import { useStratum } from "../provider.js";
import { TableSkeleton } from "./TableSkeleton.js";

export interface PermissionEditorProps {
  className?: string;
}

const MODES = ["LOCKED", "INHERITED", "DELEGATED"] as const;
const REVOCATION_MODES = ["CASCADE", "SOFT", "PERMANENT"] as const;

export function PermissionEditor({ className }: PermissionEditorProps) {
  const { permissions, loading, error, createPermission, deletePermission } = usePermissions();
  const { toast } = useStratum();
  const { t } = useMessages();
  const [newKey, setNewKey] = useState("");
  const [newMode, setNewMode] = useState<string>("INHERITED");
  const [newRevocationMode, setNewRevocationMode] = useState<string>("CASCADE");

  if (loading) {
    return (
      <div className={`stratum-permission-editor ${className || ""}`}>
        <TableSkeleton rows={5} columns={6} />
      </div>
    );
  }
  if (error) return <div className={className}>{t("permissionEditor.error", { message: error.message })}</div>;

  const handleAdd = async () => {
    if (!newKey) return;
    try {
      await createPermission(newKey, true, newMode, newRevocationMode);
      toast.success(`Permission "${newKey}" added`);
      setNewKey("");
      setNewMode("INHERITED");
      setNewRevocationMode("CASCADE");
    } catch (err) {
      toast.error(`Failed to add permission "${newKey}": ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleDelete = async (key: string, sourceTenantId: string) => {
    try {
      await deletePermission(sourceTenantId);
      toast.success(`Permission "${key}" removed`);
    } catch (err) {
      toast.error(`Failed to remove permission "${key}": ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className={`stratum-permission-editor ${className || ""}`}>
      <table className="stratum-permission-editor__table">
        <thead>
          <tr>
            <th>{t("permissionEditor.columnKey")}</th>
            <th>{t("permissionEditor.columnValue")}</th>
            <th>{t("permissionEditor.columnMode")}</th>
            <th>{t("permissionEditor.columnSource")}</th>
            <th>{t("permissionEditor.columnStatus")}</th>
            <th>{t("permissionEditor.columnActions")}</th>
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
                {perm.locked && <span className="stratum-badge stratum-badge--locked">{t("permissionEditor.locked")}</span>}
                {perm.delegated && <span className="stratum-badge stratum-badge--delegated">{t("permissionEditor.delegated")}</span>}
              </td>
              <td>
                {!perm.locked && (
                  <button type="button" onClick={() => handleDelete(perm.key, perm.source_tenant_id)}>
                    {t("permissionEditor.removeButton")}
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
          placeholder={t("permissionEditor.keyPlaceholder")}
          aria-label={t("permissionEditor.keyLabel")}
        />
        <select
          value={newMode}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setNewMode(e.target.value)}
          aria-label={t("permissionEditor.modeLabel")}
        >
          {MODES.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <select
          value={newRevocationMode}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setNewRevocationMode(e.target.value)}
          aria-label={t("permissionEditor.revocationModeLabel")}
        >
          {REVOCATION_MODES.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <button type="button" onClick={handleAdd} disabled={!newKey}>
          {t("permissionEditor.addButton")}
        </button>
      </div>
    </div>
  );
}
