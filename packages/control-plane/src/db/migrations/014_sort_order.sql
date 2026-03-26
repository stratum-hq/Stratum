-- Add sort_order column for sibling reordering
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- Index for efficient ordering queries
CREATE INDEX IF NOT EXISTS idx_tenant_sort_order ON tenants(parent_id, sort_order);
