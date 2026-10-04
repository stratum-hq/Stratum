import React, { useEffect, useId, useRef, useState } from "react";
import { useConfig, type ConfigWithInheritance } from "../hooks/use-config.js";
import { useMessages } from "../hooks/use-messages.js";
import { useStratum } from "../provider.js";
import { ConfirmAction } from "./ConfirmAction.js";
import { TableSkeleton } from "./TableSkeleton.js";

export interface ConfigEditorProps {
  className?: string;
}

type ParsedValue = { ok: true; value: unknown } | { ok: false };

function parseJson(text: string): ParsedValue {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The source tenant's name, or a short ID when the name could not be loaded. */
function sourceLabel(entry: ConfigWithInheritance): string {
  return entry.source_tenant_name ?? `${entry.source_tenant_id.slice(0, 8)}…`;
}

/** True when an ancestor locked the key, so the current tenant cannot write it. */
function lockedByAncestor(entry: ConfigWithInheritance): boolean {
  return entry.locked && entry.inherited;
}

/** True when the key is sensitive, so a write to it must keep the flag. */
function isSensitive(entry: ConfigWithInheritance): boolean {
  return entry.sensitive === true || entry.masked === true;
}

export function ConfigEditor({ className }: ConfigEditorProps) {
  const { config, loading, error, setConfigValue, deleteConfigValue } = useConfig();
  const { toast } = useStratum();
  const { t } = useMessages();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editInvalid, setEditInvalid] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newInvalid, setNewInvalid] = useState(false);
  const [newLocked, setNewLocked] = useState(false);
  const errorId = useId();
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  // The Edit button to focus after an edit is cancelled, so keyboard focus is not lost.
  const focusAfterEdit = useRef<string | null>(null);

  useEffect(() => {
    if (editingKey === null && focusAfterEdit.current) {
      editButtons.current.get(focusAfterEdit.current)?.focus();
      focusAfterEdit.current = null;
    }
  }, [editingKey]);

  if (loading) {
    return (
      <div className={`stratum-config-editor ${className || ""}`}>
        <TableSkeleton rows={5} columns={5} />
      </div>
    );
  }
  if (error) return <div className={className}>{t("configEditor.error", { message: error.message })}</div>;

  const startEdit = (entry: ConfigWithInheritance) => {
    setEditingKey(entry.key);
    setEditValue(entry.masked ? "" : JSON.stringify(entry.value));
    setEditInvalid(false);
  };

  const cancelEdit = (key: string) => {
    focusAfterEdit.current = key;
    setEditingKey(null);
    setEditInvalid(false);
  };

  // Text that is not JSON is saved only when the user asks for a string,
  // because a typo in JSON would otherwise change the value's type silently.
  const handleSave = async (entry: ConfigWithInheritance, asString = false) => {
    const { key } = entry;
    const parsed: ParsedValue = asString ? { ok: true, value: editValue } : parseJson(editValue);
    if (!parsed.ok) {
      setEditInvalid(true);
      return;
    }
    try {
      // A save keeps the lock and the sensitive flag of a key this tenant owns.
      // An override of an inherited key starts unlocked and keeps the key's
      // sensitive flag.
      if (entry.inherited) await setConfigValue(key, parsed.value, false, isSensitive(entry));
      else await setConfigValue(key, parsed.value, entry.locked, entry.sensitive ?? false);
      setEditingKey(null);
      setEditInvalid(false);
      toast.success(`Config "${key}" saved successfully`);
    } catch (err) {
      toast.error(t("configEditor.saveFailed", { key }), errorText(err));
    }
  };

  const handleToggleLock = async (entry: ConfigWithInheritance) => {
    const locked = !entry.locked;
    try {
      await setConfigValue(entry.key, entry.value, locked, entry.sensitive ?? false);
      toast.success(`Config "${entry.key}" ${locked ? "locked" : "unlocked"}`);
    } catch (err) {
      toast.error(t("configEditor.lockFailed", { key: entry.key }), errorText(err));
    }
  };

  const handleDelete = async (key: string) => {
    try {
      await deleteConfigValue(key);
      toast.success(`Config "${key}" removed`);
    } catch (err) {
      toast.error(t("configEditor.removeFailed", { key }), errorText(err));
    }
  };

  const handleAdd = async (asString = false) => {
    if (!newKey) return;
    const parsed: ParsedValue = asString ? { ok: true, value: newValue } : parseJson(newValue);
    if (!parsed.ok) {
      setNewInvalid(true);
      return;
    }
    try {
      const existing = config.find((entry) => entry.key === newKey);
      await setConfigValue(newKey, parsed.value, newLocked, existing ? isSensitive(existing) : false);
      toast.success(`Config "${newKey}" added`);
      setNewKey("");
      setNewValue("");
      setNewLocked(false);
      setNewInvalid(false);
    } catch (err) {
      toast.error(t("configEditor.addFailed", { key: newKey }), errorText(err));
    }
  };

  const invalidJsonMessage = (id: string, onSaveAsString: () => void) => (
    <div className="stratum-config-editor__field-error">
      <p id={id} role="alert">{t("configEditor.invalidJson")}</p>
      <button type="button" onClick={onSaveAsString}>{t("configEditor.saveAsStringButton")}</button>
    </div>
  );

  const editErrorId = `${errorId}-edit`;
  const addErrorId = `${errorId}-add`;
  const columns = {
    key: t("configEditor.columnKey"),
    value: t("configEditor.columnValue"),
    source: t("configEditor.columnSource"),
    status: t("configEditor.columnStatus"),
    actions: t("configEditor.columnActions"),
  };

  return (
    <div className={`stratum-config-editor ${className || ""}`}>
      <div className="stratum-table-scroll">
        {/* The explicit roles keep the table semantics when the narrow layout changes the display of the rows. */}
        <table className="stratum-config-editor__table" role="table">
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader">{columns.key}</th>
              <th role="columnheader">{columns.value}</th>
              <th role="columnheader">{columns.source}</th>
              <th role="columnheader">{columns.status}</th>
              <th role="columnheader">{columns.actions}</th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {config.map((entry) => (
              <tr key={entry.key} role="row" className={entry.locked ? "stratum-config-editor__row--locked" : ""}>
                <td role="cell" data-label={columns.key} className="stratum-config-editor__key">{entry.key}</td>
                <td role="cell" data-label={columns.value} className="stratum-config-editor__value">
                  {editingKey === entry.key ? (
                    <>
                      <input
                        type="text"
                        value={editValue}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                          setEditValue(e.target.value);
                          setEditInvalid(false);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSave(entry);
                          else if (e.key === "Escape") cancelEdit(entry.key);
                        }}
                        aria-label={t("configEditor.editLabel", { key: entry.key })}
                        aria-invalid={editInvalid || undefined}
                        aria-describedby={editInvalid ? editErrorId : undefined}
                      />
                      {editInvalid && invalidJsonMessage(editErrorId, () => handleSave(entry, true))}
                    </>
                  ) : entry.masked ? (
                    <span className="stratum-config-editor__masked">{t("configEditor.masked")}</span>
                  ) : (
                    <code>{JSON.stringify(entry.value)}</code>
                  )}
                </td>
                <td
                  role="cell"
                  data-label={columns.source}
                  className="stratum-config-editor__source"
                  title={entry.source_tenant_id}
                >
                  {sourceLabel(entry)}
                </td>
                <td role="cell" data-label={columns.status} className="stratum-config-editor__status">
                  {entry.locked && <span className="stratum-badge stratum-badge--locked">{t("configEditor.locked")}</span>}
                  {entry.inherited && !entry.locked && (
                    <span className="stratum-badge stratum-badge--inherited">{t("configEditor.inherited")}</span>
                  )}
                  {!entry.inherited && !entry.locked && (
                    <span className="stratum-badge stratum-badge--own">{t("configEditor.own")}</span>
                  )}
                </td>
                <td role="cell" data-label={columns.actions} className="stratum-config-editor__actions">
                  {lockedByAncestor(entry) ? (
                    <span className="stratum-config-editor__locked-by">
                      {t("configEditor.lockedBy", { tenant: sourceLabel(entry) })}
                    </span>
                  ) : editingKey === entry.key ? (
                    <>
                      <button type="button" onClick={() => handleSave(entry)}>{t("configEditor.saveButton")}</button>
                      <button type="button" onClick={() => cancelEdit(entry.key)}>{t("configEditor.cancelButton")}</button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        ref={(el) => {
                          if (el) editButtons.current.set(entry.key, el);
                          else editButtons.current.delete(entry.key);
                        }}
                        onClick={() => startEdit(entry)}
                      >
                        {t("configEditor.editButton")}
                      </button>
                      {!entry.inherited && (
                        <button type="button" onClick={() => handleToggleLock(entry)}>
                          {entry.locked ? t("configEditor.unlockButton") : t("configEditor.lockButton")}
                        </button>
                      )}
                      {!entry.inherited && (
                        <ConfirmAction
                          label={t("configEditor.removeButton")}
                          prompt={t("configEditor.removePrompt", { key: entry.key })}
                          confirmLabel={t("configEditor.confirmRemoveButton")}
                          cancelLabel={t("configEditor.keepButton")}
                          onConfirm={() => handleDelete(entry.key)}
                        />
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            setNewValue(e.target.value);
            setNewInvalid(false);
          }}
          placeholder={t("configEditor.valuePlaceholder")}
          aria-label={t("configEditor.valueLabel")}
          aria-invalid={newInvalid || undefined}
          aria-describedby={newInvalid ? addErrorId : undefined}
        />
        <label className="stratum-config-editor__lock-option">
          <input
            type="checkbox"
            checked={newLocked}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewLocked(e.target.checked)}
          />
          {t("configEditor.lockNewLabel")}
        </label>
        <button type="button" onClick={() => handleAdd()} disabled={!newKey}>
          {t("configEditor.addButton")}
        </button>
        {newInvalid && invalidJsonMessage(addErrorId, () => handleAdd(true))}
      </div>
    </div>
  );
}
