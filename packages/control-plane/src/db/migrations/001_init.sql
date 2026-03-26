-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "ltree";

-- Fail hard if application role has BYPASSRLS privilege
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND rolbypassrls) THEN
    RAISE EXCEPTION 'SECURITY: Application role "%" must not have BYPASSRLS privilege. Create a dedicated role without BYPASSRLS.', current_user;
  END IF;
END $$;

-- Tenant nodes table
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  parent_id UUID REFERENCES tenants(id) ON DELETE RESTRICT,
  ancestry_path TEXT NOT NULL,
  ancestry_ltree ltree,
  depth INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE
    CHECK (slug ~ '^[a-z][a-z0-9_]{0,62}$'),
  config JSONB NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}',
  isolation_strategy TEXT NOT NULL DEFAULT 'SHARED_RLS'
    CHECK (isolation_strategy IN ('SHARED_RLS')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-update updated_at function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_tenants_updated_at ON tenants;
CREATE TRIGGER update_tenants_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger to maintain ancestry_ltree from parent's ltree + own slug
CREATE OR REPLACE FUNCTION maintain_ancestry_ltree()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.parent_id IS NULL THEN
    NEW.ancestry_ltree = NEW.slug::ltree;
  ELSE
    SELECT ancestry_ltree || NEW.slug::ltree INTO NEW.ancestry_ltree
    FROM tenants WHERE id = NEW.parent_id;
  END IF;
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS maintain_tenant_ancestry_ltree ON tenants;
CREATE TRIGGER maintain_tenant_ancestry_ltree
  BEFORE INSERT OR UPDATE OF parent_id, slug ON tenants
  FOR EACH ROW EXECUTE FUNCTION maintain_ancestry_ltree();

-- Indexes for tree queries
CREATE INDEX IF NOT EXISTS idx_tenant_parent ON tenants(parent_id);
CREATE INDEX IF NOT EXISTS idx_tenant_ancestry ON tenants USING GIST (ancestry_ltree);
CREATE INDEX IF NOT EXISTS idx_tenant_depth ON tenants(depth);
CREATE INDEX IF NOT EXISTS idx_tenant_slug ON tenants(slug);
CREATE INDEX IF NOT EXISTS idx_tenant_status ON tenants(status) WHERE status = 'active';

-- Permission policies table
CREATE TABLE IF NOT EXISTS permission_policies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  key TEXT NOT NULL,
  value JSONB NOT NULL DEFAULT 'true',
  mode TEXT NOT NULL DEFAULT 'INHERITED'
    CHECK (mode IN ('LOCKED', 'INHERITED', 'DELEGATED')),
  revocation_mode TEXT NOT NULL DEFAULT 'CASCADE'
    CHECK (revocation_mode IN ('CASCADE', 'SOFT', 'PERMANENT')),
  source_tenant_id UUID NOT NULL REFERENCES tenants(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, key)
);

CREATE INDEX IF NOT EXISTS idx_permission_source ON permission_policies(source_tenant_id);

DROP TRIGGER IF EXISTS update_permission_policies_updated_at ON permission_policies;
CREATE TRIGGER update_permission_policies_updated_at
  BEFORE UPDATE ON permission_policies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Config entries table
CREATE TABLE IF NOT EXISTS config_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  inherited BOOLEAN NOT NULL DEFAULT false,
  source_tenant_id UUID NOT NULL REFERENCES tenants(id),
  locked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, key)
);

DROP TRIGGER IF EXISTS update_config_entries_updated_at ON config_entries;
CREATE TRIGGER update_config_entries_updated_at
  BEFORE UPDATE ON config_entries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Config entries uses ON DELETE CASCADE (unlike permission_policies which uses RESTRICT)
-- because config values are safe to delete with a tenant — they carry no semantic guarantees
-- like PERMANENT revocation mode. If soft-delete is used (v1 default), CASCADE never fires.

-- API keys table (for control plane auth)
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL,
  key_prefix VARCHAR(16),
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys (key_hash);
