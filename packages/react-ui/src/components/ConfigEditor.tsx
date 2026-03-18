import React, { useState } from "react";
import { useConfig } from "../hooks/use-config.js";
import { useMessages } from "../hooks/use-messages.js";
import { useStratum } from "../provider.js";
import { TableSkeleton } from "./TableSkeleton.js";

export interface ConfigEditorProps {
  className?: string;
}

export function ConfigEditor({ className }: ConfigEditorProps) {
  const { config, loading, error, setConfigValue, deleteConfigValue } = useConfig();
  const { toast } = useStratum();
  const { t } = useMessages();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  if (loading) {
    return (
      <div className={`stratum-config-editor ${className || ""}`}>
        <TableSkeleton rows={5} columns={5} />
      </div>
    );
  }
  if (error) return <div className={className}>{t("configEditor.error", { message: error.message })}</div>;

  const handleSave = async (key: string) => {
    try {
      let value: unknown;
      try {
        value = JSON.parse(editValue);
      } catch {
        value = editValue;
      }
      await setConfigValue(key, value);
      setEditingKey(null);
      toast.success(`Config "${key}" saved successfully`);
    } catch (err) {
      toast.error(`Failed to save config "${key}": ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleDelete = async (key: string) => {
    try {
      await deleteConfigValue(key);
      toast.success(`Config "${key}" removed`);
    } catch (err) {
      toast.error(`Failed to remove config "${key}": ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleAdd = async () => {
    if (!newKey) return;
    try {
      let value: unknown;
      try {
        value = JSON.parse(newValue);
      } catch {
        value = newValue;
      }
      await setConfigValue(newKey, value);
      toast.success(`Config "${newKey}" added`);
      setNewKey("");
      setNewValue("");
    } catch (err) {
      toast.error(`Failed to add config "${newKey}": ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className={`stratum-config-editor ${className || ""}`}>
      <table className="stratum-config-editor__table">
        <thead>
          <tr>
            <th>{t("configEditor.columnKey")}</th>
            <th>{t("configEditor.columnValue")}</th>
            <th>{t("configEditor.columnSource")}</th>
            <th>{t("configEditor.columnStatus")}</th>
            <th>{t("configEditor.columnActions")}</th>
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
                    aria-label={t("configEditor.editLabel", { key: entry.key })}
                  />
                ) : (
                  <code>{JSON.stringify(entry.value)}</code>
                )}
              </td>
              <td className="stratum-config-editor__source">
                {entry.source_tenant_id.slice(0, 8)}...
              </td>
              <td>
                {entry.locked && <span className="stratum-badge stratum-badge--locked">{t("configEditor.locked")}</span>}
                {entry.inherited && !entry.locked && (
                  <span className="stratum-badge stratum-badge--inherited">{t("configEditor.inherited")}</span>
                )}
                {!entry.inherited && !entry.locked && (
                  <span className="stratum-badge stratum-badge--own">{t("configEditor.own")}</span>
                )}
              </td>
              <td>
                {!entry.locked && (
                  <>
                    {editingKey === entry.key ? (
                      <>
                        <button type="button" onClick={() => handleSave(entry.key)}>{t("configEditor.saveButton")}</button>
                        <button type="button" onClick={() => setEditingKey(null)}>{t("configEditor.cancelButton")}</button>
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
                          {t("configEditor.editButton")}
                        </button>
                        {!entry.inherited && (
                          <button type="button" onClick={() => handleDelete(entry.key)}>
                            {t("configEditor.removeButton")}
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
          placeholder={t("configEditor.keyPlaceholder")}
          aria-label={t("configEditor.keyLabel")}
        />
        <input
          type="text"
          value={newValue}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewValue(e.target.value)}
          placeholder={t("configEditor.valuePlaceholder")}
          aria-label={t("configEditor.valueLabel")}
        />
        <button type="button" onClick={handleAdd} disabled={!newKey}>
          {t("configEditor.addButton")}
        </button>
      </div>
    </div>
  );
}
