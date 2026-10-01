-- Migration 031: Opt-in subtree read scope for row-level security.
--
-- A session scoped to tenant T can opt in to read the rows of T and of every
-- descendant of T. The default stays exact-tenant isolation (019, 020).
--
-- Context model, in addition to 019:
--   * Subtree scope: SET LOCAL app.tenant_scope = 'subtree' (transaction
--     scoped). Only the exact value 'subtree' widens reads. The library sets it
--     only through its context helpers (db-adapters setTenantContext and
--     withTenantContext with { scope: 'subtree' }).
--
-- Reads only. Each table gets a second permissive policy, tenant_subtree_read,
-- FOR SELECT. PostgreSQL ORs it with tenant_isolation for reads. INSERT,
-- UPDATE and DELETE must also pass the policies for their own command, and
-- tenant_isolation is the only one. Writes therefore stay limited to the exact
-- tenant: an insert for a descendant fails WITH CHECK, and UPDATE and DELETE
-- do not reach a descendant's rows. The 019 and 020 policies do not change.
--
-- Tenant status does not affect the scope. Suspended, archived and pending
-- descendants are in the subtree, as exact-tenant RLS ignores status too.
-- Applications filter by status when they need to.
--
-- The bypass (app.bypass_rls = 'on') does not change: it sees every row.

-- ---------------------------------------------------------------------------
-- stratum_subtree_tenant_ids(): the current tenant and all its descendants.
--
-- The subtree is selected by the ID-based ancestry_path, not by the
-- slug-derived ancestry_ltree, for the reason getDescendants gives in
-- tenant-service.ts: an isolation boundary must not follow slugs. A
-- descendant's ancestry_path is the subtree path itself or starts with it
-- plus '/'. The ~>=~ / ~<~ range lets idx_tenant_ancestry_path_prefix (028)
-- serve the lookup with a value known only at run time ('0' is the character
-- after '/'). The LIKE then drops what the range admits but is not a path
-- segment boundary.
--
-- The policies call the function in a scalar subquery, so PostgreSQL runs it
-- once per statement as an InitPlan and then matches tenant_id against the
-- array with the table's own index.
--
-- The function must read the whole subtree while the caller sees only its own
-- tenants row (019). It does what 029 does: SECURITY DEFINER would not help,
-- because FORCE ROW LEVEL SECURITY applies to the owner too, so a SET clause
-- turns on the 019 bypass for the function's own duration. A SET clause is
-- restored when the function exits, on error too. The second SET clause clears
-- app.tenant_scope inside the function, so the tenant_subtree_read policy on
-- tenants cannot call the function again while it runs.
--
-- The function returns only ids in the subtree of app.current_tenant_id. A
-- session that can call it can already set both settings, so it gives no new
-- access. With no current tenant it returns an empty array.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION stratum_subtree_tenant_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SET app.bypass_rls = 'on'
SET app.tenant_scope = ''
AS $$
  WITH cur AS (
    SELECT t.id, rtrim(t.ancestry_path, '/') || '/' || t.id::text AS sub
    FROM tenants t
    WHERE t.id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  )
  SELECT coalesce(array_agg(s.id), '{}'::uuid[])
  FROM (
    SELECT cur.id FROM cur
    UNION ALL
    SELECT d.id
    FROM cur
    JOIN tenants d
      ON d.ancestry_path ~>=~ cur.sub
     AND d.ancestry_path ~<~ (cur.sub || '0')
     AND (d.ancestry_path = cur.sub OR d.ancestry_path LIKE cur.sub || '/%')
  ) s
$$;

DO $pin$ BEGIN
  EXECUTE format(
    'ALTER FUNCTION stratum_subtree_tenant_ids() SET search_path = pg_catalog, %I',
    current_schema()
  );
END $pin$;

-- Reusable predicate (inlined per policy below, as in 019):
--   current_setting('app.tenant_scope', true) = 'subtree'
--   AND tenant_id = ANY ((SELECT stratum_subtree_tenant_ids())::uuid[])
-- The scope check comes first. With any other scope the AND stops there, so
-- the default path never runs the function.

-- ---------------------------------------------------------------------------
-- Direct tenant_id tables.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS tenant_subtree_read ON config_entries;
CREATE POLICY tenant_subtree_read ON config_entries FOR SELECT
  USING (
    current_setting('app.tenant_scope', true) = 'subtree'
    AND tenant_id = ANY ((SELECT stratum_subtree_tenant_ids())::uuid[])
  );

DROP POLICY IF EXISTS tenant_subtree_read ON permission_policies;
CREATE POLICY tenant_subtree_read ON permission_policies FOR SELECT
  USING (
    current_setting('app.tenant_scope', true) = 'subtree'
    AND tenant_id = ANY ((SELECT stratum_subtree_tenant_ids())::uuid[])
  );

DROP POLICY IF EXISTS tenant_subtree_read ON audit_logs;
CREATE POLICY tenant_subtree_read ON audit_logs FOR SELECT
  USING (
    current_setting('app.tenant_scope', true) = 'subtree'
    AND tenant_id = ANY ((SELECT stratum_subtree_tenant_ids())::uuid[])
  );

DROP POLICY IF EXISTS tenant_subtree_read ON webhook_events;
CREATE POLICY tenant_subtree_read ON webhook_events FOR SELECT
  USING (
    current_setting('app.tenant_scope', true) = 'subtree'
    AND tenant_id = ANY ((SELECT stratum_subtree_tenant_ids())::uuid[])
  );

DROP POLICY IF EXISTS tenant_subtree_read ON webhooks;
CREATE POLICY tenant_subtree_read ON webhooks FOR SELECT
  USING (
    current_setting('app.tenant_scope', true) = 'subtree'
    AND tenant_id = ANY ((SELECT stratum_subtree_tenant_ids())::uuid[])
  );

DROP POLICY IF EXISTS tenant_subtree_read ON consent_records;
CREATE POLICY tenant_subtree_read ON consent_records FOR SELECT
  USING (
    current_setting('app.tenant_scope', true) = 'subtree'
    AND tenant_id = ANY ((SELECT stratum_subtree_tenant_ids())::uuid[])
  );

DROP POLICY IF EXISTS tenant_subtree_read ON abac_policies;
CREATE POLICY tenant_subtree_read ON abac_policies FOR SELECT
  USING (
    current_setting('app.tenant_scope', true) = 'subtree'
    AND tenant_id = ANY ((SELECT stratum_subtree_tenant_ids())::uuid[])
  );

DROP POLICY IF EXISTS tenant_subtree_read ON api_keys;
CREATE POLICY tenant_subtree_read ON api_keys FOR SELECT
  USING (
    current_setting('app.tenant_scope', true) = 'subtree'
    AND tenant_id = ANY ((SELECT stratum_subtree_tenant_ids())::uuid[])
  );

DROP POLICY IF EXISTS tenant_subtree_read ON roles;
CREATE POLICY tenant_subtree_read ON roles FOR SELECT
  USING (
    current_setting('app.tenant_scope', true) = 'subtree'
    AND tenant_id = ANY ((SELECT stratum_subtree_tenant_ids())::uuid[])
  );

DROP POLICY IF EXISTS tenant_subtree_read ON usage_events;
CREATE POLICY tenant_subtree_read ON usage_events FOR SELECT
  USING (
    current_setting('app.tenant_scope', true) = 'subtree'
    AND tenant_id = ANY ((SELECT stratum_subtree_tenant_ids())::uuid[])
  );

-- ---------------------------------------------------------------------------
-- tenants registry: the subtree's own registry rows, on id.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS tenant_subtree_read ON tenants;
CREATE POLICY tenant_subtree_read ON tenants FOR SELECT
  USING (
    current_setting('app.tenant_scope', true) = 'subtree'
    AND id = ANY ((SELECT stratum_subtree_tenant_ids())::uuid[])
  );

-- ---------------------------------------------------------------------------
-- Indirect tables: scoped through their tenant-bearing parent, as in 019.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS tenant_subtree_read ON webhook_deliveries;
CREATE POLICY tenant_subtree_read ON webhook_deliveries FOR SELECT
  USING (
    current_setting('app.tenant_scope', true) = 'subtree'
    AND EXISTS (
      SELECT 1 FROM webhook_events we
      WHERE we.id = webhook_deliveries.event_id
        AND we.tenant_id = ANY ((SELECT stratum_subtree_tenant_ids())::uuid[])
    )
  );

DROP POLICY IF EXISTS tenant_subtree_read ON principal_roles;
CREATE POLICY tenant_subtree_read ON principal_roles FOR SELECT
  USING (
    current_setting('app.tenant_scope', true) = 'subtree'
    AND EXISTS (
      SELECT 1 FROM roles r
      WHERE r.id = principal_roles.role_id
        AND r.tenant_id = ANY ((SELECT stratum_subtree_tenant_ids())::uuid[])
    )
  );
