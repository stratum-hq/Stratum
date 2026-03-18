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
  "configEditor.saveButton": "Save",
  "configEditor.cancelButton": "Cancel",
  "configEditor.editButton": "Edit",
  "configEditor.removeButton": "Remove",
  "configEditor.keyPlaceholder": "New key",
  "configEditor.keyLabel": "New config key",
  "configEditor.valuePlaceholder": "Value (JSON or string)",
  "configEditor.valueLabel": "New config value",
  "configEditor.addButton": "Add",

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
  "permissionEditor.keyPlaceholder": "Permission key",
  "permissionEditor.keyLabel": "New permission key",
  "permissionEditor.modeLabel": "Permission mode",
  "permissionEditor.revocationModeLabel": "Revocation mode",
  "permissionEditor.addButton": "Add",
} as const;

export type MessageKey = keyof typeof defaultMessages;
export type Messages = Partial<Record<MessageKey, string>>;
