// Shared types used across demo dashboard sections

export interface ConfigInheritanceEntry {
  key: string;
  value: unknown;
  source_tenant_id: string;
  inherited: boolean;
  locked: boolean;
}

export interface ConfigInheritanceResponse {
  data?: ConfigInheritanceEntry[];
  inheritance?: ConfigInheritanceEntry[];
}

export interface PermissionEntry {
  policy_id: string;
  key: string;
  value: unknown;
  mode: string;
  source_tenant_id: string;
  locked: boolean;
  delegated: boolean;
}

export interface PermissionsResponse {
  [key: string]: PermissionEntry;
}

export interface SecurityEvent {
  id: number;
  event_type: string;
  severity: string;
  source_ip: string | null;
  description: string;
  created_at: string;
}

export interface AuditEntry {
  id: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  actor_id: string;
  actor_type: string;
  tenant_id: string | null;
  created_at: string;
}

export interface ApiKeyEntry {
  id: string;
  tenant_id: string | null;
  name: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  expires_at: string | null;
}

export interface WebhookEntry {
  id: string;
  tenant_id: string | null;
  url: string;
  events: string[];
  active: boolean;
  secret: string;
  created_at: string;
}

export type TabId = "overview" | "config" | "permissions" | "events" | "audit" | "api-keys" | "webhooks";
