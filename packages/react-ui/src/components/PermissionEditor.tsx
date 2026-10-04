import React, { useState } from "react";
import { usePermissions, type PermissionWithSource } from "../hooks/use-permissions.js";
import { useMessages } from "../hooks/use-messages.js";
import { useTenant } from "../hooks/use-tenant.js";
import { useStratum } from "../provider.js";
import { ConfirmAction } from "./ConfirmAction.js";
import { TableSkeleton } from "./TableSkeleton.js";

export interface PermissionEditorProps {
  className?: string;
}

const MODES = ["LOCKED", "INHERITED", "DELEGATED"] as const;
const REVOCATION_MODES = ["CASCADE", "SOFT", "PERMANENT"] as const;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The source tenant's name, or a short ID when the name could not be loaded. */
function sourceLabel(perm: PermissionWithSource): string {
  return perm.source_tenant_name ?? `${perm.source_tenant_id.slice(0, 8)}…`;
}

export function PermissionEditor({ className }: PermissionEditorProps) {
  const { permissions, loading, error, createPermission, deletePermission } = usePermissions();
  // The API deletes only the current tenant's own policies, so Remove shows only on those rows.
  const { tenant } = useTenant();
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
      toast.error(t("permissionEditor.addFailed", { key: newKey }), errorText(err));
    }
  };

  const handleDelete = async (key: string, policyId: string) => {
    try {
      await deletePermission(policyId);
      toast.success(`Permission "${key}" removed`);
    } catch (err) {
      toast.error(t("permissionEditor.removeFailed", { key }), errorText(err));
    }
  };

  return (
    <div className={`stratum-permission-editor ${className || ""}`}>
      <div className="stratum-table-scroll">
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
                <td className="stratum-permission-editor__source" title={perm.source_tenant_id}>
                  {sourceLabel(perm)}
                </td>
                <td>
                  {perm.locked && <span className="stratum-badge stratum-badge--locked">{t("permissionEditor.locked")}</span>}
                  {perm.delegated && <span className="stratum-badge stratum-badge--delegated">{t("permissionEditor.delegated")}</span>}
                </td>
                <td>
                  {perm.source_tenant_id !== tenant?.id ? (
                    <span className="stratum-permission-editor__set-by">
                      {t("permissionEditor.setBy", { tenant: sourceLabel(perm) })}
                    </span>
                  ) : !perm.locked && (
                    <ConfirmAction
                      label={t("permissionEditor.removeButton")}
                      prompt={t("permissionEditor.removePrompt", { key: perm.key })}
                      confirmLabel={t("permissionEditor.confirmRemoveButton")}
                      cancelLabel={t("permissionEditor.keepButton")}
                      onConfirm={() => handleDelete(perm.key, perm.policy_id)}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
