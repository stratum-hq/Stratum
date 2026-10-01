-- RLS policy templates for tenant isolation
-- These are reference SQL templates used by the db-adapters package.

-- Enable RLS on a table
-- ALTER TABLE {table_name} ENABLE ROW LEVEL SECURITY;

-- Create the tenant isolation policy
-- CREATE POLICY tenant_isolation ON {table_name}
--   USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Optional: let a session in the subtree scope read the rows of the tenant's
-- descendants. Reads only; writes stay with tenant_isolation. Needs migration
-- 031 of @stratum-hq/lib, which creates stratum_subtree_tenant_ids().
-- CREATE POLICY tenant_subtree_read ON {table_name} FOR SELECT
--   USING (current_setting('app.tenant_scope', true) = 'subtree'
--          AND tenant_id = ANY ((SELECT stratum_subtree_tenant_ids())::uuid[]));

-- Drop the tenant isolation policies
-- DROP POLICY IF EXISTS tenant_isolation ON {table_name};
-- DROP POLICY IF EXISTS tenant_subtree_read ON {table_name};

-- Disable RLS on a table
-- ALTER TABLE {table_name} DISABLE ROW LEVEL SECURITY;

-- Set tenant context for the current transaction
-- SET LOCAL app.current_tenant_id = '{tenant_id}';
-- Optional: opt in to the subtree read scope for the current transaction
-- SET LOCAL app.tenant_scope = 'subtree';

-- Reset tenant context
-- RESET app.current_tenant_id;

-- Read the current tenant context
-- SELECT current_setting('app.current_tenant_id', true);
