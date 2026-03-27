-- 012: Role-Based Access Control (RBAC)
-- Roles define named collections of scopes that can be assigned to API keys.

CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  scopes TEXT[] NOT NULL DEFAULT ARRAY['read'],
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for tenant-scoped role lookups
CREATE INDEX IF NOT EXISTS idx_roles_tenant_id ON roles (tenant_id);

-- Add role_id column to api_keys
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS role_id UUID REFERENCES roles(id) ON DELETE SET NULL;
