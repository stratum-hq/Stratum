-- 018: Principal-agnostic role assignment
-- Roles could previously only attach to API keys (api_keys.role_id). This
-- generalizes assignment to ANY principal (an application user, a service
-- account, an API key) so applications can resolve effective scopes for their
-- own principals, not just keys. One role per principal, mirroring the single
-- role_id on api_keys.

CREATE TABLE IF NOT EXISTS principal_roles (
  principal_type TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (principal_type, principal_id)
);

-- Index for reverse lookups (which principals hold a given role).
CREATE INDEX IF NOT EXISTS idx_principal_roles_role_id ON principal_roles (role_id);
