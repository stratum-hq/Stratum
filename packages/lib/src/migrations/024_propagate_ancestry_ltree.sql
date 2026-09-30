-- Migration 024: Keep descendants' ancestry_ltree in step with their ancestors.
--
-- maintain_ancestry_ltree (001_init.sql) recomputes ancestry_ltree for the row
-- being inserted or updated only. When a tenant's slug (or parent) changes, its
-- descendants kept the old slug prefix. This AFTER trigger touches the direct
-- children whenever a row's ancestry_ltree actually changed; each child's
-- BEFORE trigger then recomputes its ltree from the updated parent, and its own
-- AFTER trigger continues down the subtree.
CREATE OR REPLACE FUNCTION propagate_ancestry_ltree()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE tenants SET slug = slug WHERE parent_id = NEW.id;
  RETURN NULL;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS propagate_tenant_ancestry_ltree ON tenants;
CREATE TRIGGER propagate_tenant_ancestry_ltree
  AFTER UPDATE OF parent_id, slug ON tenants
  FOR EACH ROW
  WHEN (OLD.ancestry_ltree IS DISTINCT FROM NEW.ancestry_ltree)
  EXECUTE FUNCTION propagate_ancestry_ltree();

-- Repair rows left stale by earlier renames: recompute every ltree from the
-- parent_id chain. Setting ancestry_ltree alone does not fire either trigger.
-- Runs under bypass so row-level security (019) does not hide rows.
SET LOCAL app.bypass_rls = 'on';

WITH RECURSIVE chain AS (
  SELECT id, slug::ltree AS lt
  FROM tenants
  WHERE parent_id IS NULL
  UNION ALL
  SELECT c.id, chain.lt || c.slug::ltree
  FROM tenants c
  JOIN chain ON c.parent_id = chain.id
)
UPDATE tenants
SET ancestry_ltree = chain.lt
FROM chain
WHERE tenants.id = chain.id
  AND tenants.ancestry_ltree IS DISTINCT FROM chain.lt;
