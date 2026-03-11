CREATE TABLE IF NOT EXISTS regions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  control_plane_url TEXT,
  database_url TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draining', 'inactive')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_regions_slug ON regions(slug);
CREATE INDEX IF NOT EXISTS idx_regions_status ON regions(status);

-- Add region_id to tenants (nullable for backward compat)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS region_id UUID REFERENCES regions(id);
CREATE INDEX IF NOT EXISTS idx_tenants_region ON tenants(region_id);
