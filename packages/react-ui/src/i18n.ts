/**
 * Default i18n messages for all Stratum React UI components.
 *
 * Keys use dot-separated component namespaces. Values may contain
 * `{param}` placeholders that are interpolated at runtime by `t()`.
 */
export const defaultMessages = {
  // TenantSwitcher
  "tenantSwitcher.loading": "Loading tenants...",
  "tenantSwitcher.placeholder": "Select tenant...",
  "tenantSwitcher.searchPlaceholder": "Search tenants...",
  "tenantSwitcher.searchLabel": "Search tenants",

  // TenantTree
  "tenantTree.loading": "Loading tree...",
  "tenantTree.error": "Error: {message}",
  "tenantTree.collapse": "Collapse",
  "tenantTree.expand": "Expand",
  "tenantTree.badgeRls": "RLS",
  "tenantTree.badgeSchema": "Schema",
  "tenantTree.badgeDatabase": "Database",
  "tenantTree.editTenant": "Edit {name}",
  "tenantTree.addChild": "Add a child tenant to {name}",
  "tenantTree.archiveTenant": "Archive {name}",
  "tenantTree.moveTenant": "Move {name}",
  "tenantTree.archived": " (archived)",

  // ConfigEditor
  "configEditor.loading": "Loading config...",
  "configEditor.error": "Error: {message}",
  "configEditor.columnKey": "Key",
  "configEditor.columnValue": "Value",
  "configEditor.columnSource": "Source",
  "configEditor.columnStatus": "Status",
  "configEditor.columnActions": "Actions",
  "configEditor.editLabel": "Edit value for {key}",
  "configEditor.locked": "Locked",
  "configEditor.inherited": "Inherited",
  "configEditor.own": "Own",
  "configEditor.masked": "Sensitive value set by an ancestor",
  "configEditor.saveButton": "Save",
  "configEditor.cancelButton": "Cancel",
  "configEditor.editButton": "Edit",
  "configEditor.removeButton": "Remove",
  "configEditor.keyPlaceholder": "New key",
  "configEditor.keyLabel": "New config key",
  "configEditor.valuePlaceholder": "Value (JSON or string)",
  "configEditor.valueLabel": "New config value",
  "configEditor.addButton": "Add",
  "configEditor.lockedBy": "Locked by {tenant}",
  "configEditor.removePrompt": "Remove {key}?",
  "configEditor.confirmRemoveButton": "Yes, remove",
  "configEditor.keepButton": "Keep",
  "configEditor.invalidJson": "Error: This value is not valid JSON. Correct it, or save it as a string.",
  "configEditor.saveAsStringButton": "Save as string",
  "configEditor.saveFailed": "Could not save \"{key}\". The value is unchanged.",
  "configEditor.addFailed": "Could not add \"{key}\".",
  "configEditor.removeFailed": "Could not remove \"{key}\". The key is unchanged.",

  // WebhookEditor
  "webhookEditor.deleteButton": "Delete",
  "webhookEditor.deletePrompt": "Delete this webhook?",
  "webhookEditor.confirmDeleteButton": "Yes, delete",
  "webhookEditor.keepButton": "Keep",
  "webhookEditor.createFailed": "Could not create the webhook.",
  "webhookEditor.deleteFailed": "Could not delete the webhook. It still receives events.",

  // PermissionEditor
  "permissionEditor.loading": "Loading permissions...",
  "permissionEditor.error": "Error: {message}",
  "permissionEditor.columnKey": "Key",
  "permissionEditor.columnValue": "Value",
  "permissionEditor.columnMode": "Mode",
  "permissionEditor.columnSource": "Source",
  "permissionEditor.columnStatus": "Status",
  "permissionEditor.columnActions": "Actions",
  "permissionEditor.locked": "Locked",
  "permissionEditor.delegated": "Delegated",
  "permissionEditor.removeButton": "Remove",
  "permissionEditor.removePrompt": "Remove {key}?",
  "permissionEditor.confirmRemoveButton": "Yes, remove",
  "permissionEditor.keepButton": "Keep",
  "permissionEditor.keyPlaceholder": "Permission key",
  "permissionEditor.keyLabel": "New permission key",
  "permissionEditor.modeLabel": "Permission mode",
  "permissionEditor.revocationModeLabel": "Revocation mode",
  "permissionEditor.addButton": "Add",
} as const;

export type MessageKey = keyof typeof defaultMessages;
export type Messages = Partial<Record<MessageKey, string>>;
