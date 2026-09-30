-- Tenant lifecycle: add the 'pending' state.
-- A SCHEMA_PER_TENANT or DB_PER_TENANT tenant is inserted as 'pending' and
-- becomes 'active' only once its schema or database has been provisioned.
-- Widen the status CHECK from 021_tenant_status_suspended.sql, keeping its name.
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_status_check;
ALTER TABLE tenants
  ADD CONSTRAINT tenants_status_check
  CHECK (status IN ('pending', 'active', 'suspended', 'archived'));
