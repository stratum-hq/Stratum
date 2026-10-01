-- Migration 029: Refuse a parent_id that makes a tenant its own ancestor.
--
-- The tenant tree must stay a tree whoever writes to it. The library already
-- checks for cycles before a move; this BEFORE trigger enforces the same rule
-- in the database. It walks up from the new parent and refuses the row when the
-- walk reaches the row itself. The walk remembers the ids it has seen, so it
-- also ends on a cycle that is already in the data.
--
-- It fires on every write that sets parent_id or slug, including the
-- `slug = slug` updates that carry ancestry_ltree down a subtree (024). A cycle
-- already present in the data therefore stops the first write that touches it
-- with this error, instead of carrying the ltree around the loop. It is named
-- so that it runs before maintain_tenant_ancestry_ltree (BEFORE triggers run in
-- name order).
--
-- The walk must see the whole chain even when the writer is under row-level
-- security (019), where a session sees only its own tenant row. SECURITY
-- DEFINER would not help: FORCE ROW LEVEL SECURITY applies to the table owner
-- too, and the recommended owner is the application role without BYPASSRLS.
-- The function therefore turns on the 019 bypass setting for its own duration
-- only (a function SET clause is restored when the function exits, on error
-- too). The function reads nothing back to the caller: it returns the row it
-- was given or raises. search_path is pinned below to pg_catalog and the
-- schema this migration runs in, which is where 001 created tenants.
CREATE OR REPLACE FUNCTION refuse_tenant_parent_cycle()
RETURNS TRIGGER
SET app.bypass_rls = 'on'
AS $$
BEGIN
  IF NEW.parent_id = NEW.id OR EXISTS (
    WITH RECURSIVE up(id, parent_id, seen) AS (
      SELECT t.id, t.parent_id, ARRAY[t.id]
      FROM tenants t
      WHERE t.id = NEW.parent_id
      UNION ALL
      SELECT t.id, t.parent_id, up.seen || t.id
      FROM tenants t
      JOIN up ON t.id = up.parent_id
      WHERE t.id <> ALL (up.seen)
    )
    SELECT 1 FROM up WHERE up.id = NEW.id
  ) THEN
    RAISE EXCEPTION 'tenant % cannot be its own ancestor (parent_id cycle)', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ language 'plpgsql';

DO $pin$ BEGIN
  EXECUTE pg_catalog.format(
    'ALTER FUNCTION refuse_tenant_parent_cycle() SET search_path = pg_catalog, %I',
    pg_catalog.current_schema()
  );
END $pin$;

DROP TRIGGER IF EXISTS guard_tenant_parent_cycle ON tenants;
CREATE TRIGGER guard_tenant_parent_cycle
  BEFORE INSERT OR UPDATE OF parent_id, slug ON tenants
  FOR EACH ROW
  WHEN (NEW.parent_id IS NOT NULL)
  EXECUTE FUNCTION refuse_tenant_parent_cycle();
