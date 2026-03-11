-- RLS policy templates for tenant isolation
-- These are reference SQL templates used by the db-adapters package.

-- Enable RLS on a table
-- ALTER TABLE {table_name} ENABLE ROW LEVEL SECURITY;

-- Create the tenant isolation policy
-- CREATE POLICY tenant_isolation ON {table_name}
--   USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Drop the tenant isolation policy
-- DROP POLICY IF EXISTS tenant_isolation ON {table_name};

-- Disable RLS on a table
-- ALTER TABLE {table_name} DISABLE ROW LEVEL SECURITY;

-- Set tenant context for the current transaction
-- SET LOCAL app.current_tenant_id = '{tenant_id}';

-- Reset tenant context
-- RESET app.current_tenant_id;

-- Read the current tenant context
-- SELECT current_setting('app.current_tenant_id', true);
