-- Migration 019: Real Postgres row-level security for the SHARED_RLS strategy.
--
-- Backs the `isolation_strategy = 'SHARED_RLS'` literal (001_init.sql) with
-- database-enforced tenant isolation. This is a SECOND, independent layer; the
-- application control-plane authorization stays the primary enforcement. See
-- docs/adr/0001-postgres-rls-defense-in-depth.md for the full design.
--
-- Context model:
--   * Tenant context: SET LOCAL app.current_tenant_id (transaction scoped).
--   * System bypass:   SET LOCAL app.bypass_rls = 'on' (control-plane path).
--   Both are set with set_config(..., true) / SET LOCAL so they cannot leak
--   across pooled connections.
--
-- Every policy is fail closed: with no context set,
--   NULLIF(current_setting('app.current_tenant_id', true), '')::uuid  ->  NULL,
-- so the scope predicate is NULL (not true) and zero rows are visible; a write
-- with no context is rejected. current_setting(name, true) returns NULL instead
-- of raising when the GUC is unset.
--
-- ENABLE + FORCE: FORCE applies the policy to the table owner too. Note that a
-- Postgres SUPERUSER or a role with BYPASSRLS always skips RLS regardless of
-- FORCE; the application role must be neither (see docker/init-db.sql:
-- stratum_app is NOSUPERUSER NOBYPASSRLS).
--
-- DROP POLICY IF EXISTS before CREATE makes the migration safe to re-run.

-- Reusable predicate (documented once; inlined per policy below because Postgres
-- policies cannot reference a shared expression):
--   current_setting('app.bypass_rls', true) = 'on'
--   OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid

-- ---------------------------------------------------------------------------
-- Direct tenant_id tables: exact-tenant scope.
-- ---------------------------------------------------------------------------

-- config_entries
ALTER TABLE config_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE config_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON config_entries;
CREATE POLICY tenant_isolation ON config_entries FOR ALL
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

-- permission_policies
ALTER TABLE permission_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE permission_policies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON permission_policies;
CREATE POLICY tenant_isolation ON permission_policies FOR ALL
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

-- audit_logs (tenant_id nullable: ON DELETE SET NULL; NULL rows visible only under bypass)
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON audit_logs;
CREATE POLICY tenant_isolation ON audit_logs FOR ALL
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

-- webhook_events
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON webhook_events;
CREATE POLICY tenant_isolation ON webhook_events FOR ALL
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

-- webhooks (tenant_id nullable)
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhooks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON webhooks;
CREATE POLICY tenant_isolation ON webhooks FOR ALL
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

-- consent_records
ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON consent_records;
CREATE POLICY tenant_isolation ON consent_records FOR ALL
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

-- abac_policies
ALTER TABLE abac_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE abac_policies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON abac_policies;
CREATE POLICY tenant_isolation ON abac_policies FOR ALL
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

-- api_keys (auth table; tenant_id nullable. Read by the control plane before a
-- tenant context exists, so it is safe only because the control plane bypasses.
-- Global keys (tenant_id NULL) are visible only under bypass.)
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON api_keys;
CREATE POLICY tenant_isolation ON api_keys FOR ALL
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

-- roles (auth table; tenant_id nullable for global roles, visible only under bypass)
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON roles;
CREATE POLICY tenant_isolation ON roles FOR ALL
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

-- ---------------------------------------------------------------------------
-- tenants registry: self-scope on id. The ancestry source; no tenant_id column.
-- A data-plane context reads only its own registry row and cannot enumerate the
-- tree. All tree / ancestry mutations are control-plane and run under bypass.
-- ---------------------------------------------------------------------------
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenants;
CREATE POLICY tenant_isolation ON tenants FOR ALL
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

-- ---------------------------------------------------------------------------
-- Indirect tables (no tenant_id): scoped through their tenant-bearing parent.
-- The parent subquery is itself RLS-filtered under a tenant context, which
-- composes correctly. No policy recursion: neither parent references back.
-- ---------------------------------------------------------------------------

-- webhook_deliveries -> webhook_events.tenant_id
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON webhook_deliveries;
CREATE POLICY tenant_isolation ON webhook_deliveries FOR ALL
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR EXISTS (
      SELECT 1 FROM webhook_events we
      WHERE we.id = webhook_deliveries.event_id
        AND we.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    )
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR EXISTS (
      SELECT 1 FROM webhook_events we
      WHERE we.id = webhook_deliveries.event_id
        AND we.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    )
  );

-- principal_roles -> roles.tenant_id (global-role assignments visible only under bypass)
ALTER TABLE principal_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE principal_roles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON principal_roles;
CREATE POLICY tenant_isolation ON principal_roles FOR ALL
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR EXISTS (
      SELECT 1 FROM roles r
      WHERE r.id = principal_roles.role_id
        AND r.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    )
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR EXISTS (
      SELECT 1 FROM roles r
      WHERE r.id = principal_roles.role_id
        AND r.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    )
  );

-- ---------------------------------------------------------------------------
-- Intentionally NOT protected (documented in the ADR):
--   * regions       -- global infrastructure catalog, no tenant_id, not tenant-private
--   * _migrations   -- internal migration bookkeeping
-- ---------------------------------------------------------------------------
