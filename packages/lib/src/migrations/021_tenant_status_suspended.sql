-- Tenant lifecycle: add the 'suspended' state (FR-58).
-- The original inline CHECK on tenants.status (001_init.sql) allowed only
-- 'active' and 'archived'. Relax it to also permit 'suspended', the reversible
-- "blocks access" state introduced by suspendTenant/resumeTenant.
--
-- The inline constraint from 001_init.sql is named tenants_status_check by
-- Postgres. Drop it if present and re-add the widened constraint under the same
-- name so the schema stays stable.
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_status_check;
ALTER TABLE tenants
  ADD CONSTRAINT tenants_status_check
  CHECK (status IN ('active', 'suspended', 'archived'));
