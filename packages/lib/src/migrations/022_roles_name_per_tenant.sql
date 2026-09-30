-- 022: Role names are unique within a tenant, not across all tenants.
-- Global roles (tenant_id IS NULL) keep a unique name among themselves.

ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS roles_tenant_name_key
  ON roles (tenant_id, name) WHERE tenant_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS roles_global_name_key
  ON roles (name) WHERE tenant_id IS NULL;
