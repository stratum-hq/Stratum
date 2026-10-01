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
-- Reads only. Each table below gets a second permissive policy, tenant_subtree_read,
-- FOR SELECT. PostgreSQL ORs it with tenant_isolation for reads. INSERT,
-- UPDATE and DELETE must also pass the policies for their own command, and
-- tenant_isolation is the only one. Writes therefore stay limited to the exact
-- tenant: an insert for a descendant fails WITH CHECK, and UPDATE and DELETE
-- do not reach a descendant's rows. SELECT ... FOR UPDATE and FOR SHARE also
-- need the UPDATE policy, so in subtree scope they return the exact tenant's
-- rows only. The 019 and 020 policies do not change.
--
-- Tables with a subtree read policy:
--   tenants (on id), config_entries (rows with sensitive = false only),
--   permission_policies, audit_logs, webhook_events, consent_records,
--   abac_policies, roles, usage_events, and, through their parent row,
--   webhook_deliveries (via webhook_events) and principal_roles (via roles).
--
-- Credential-bearing rows stay exact-tenant. api_keys and webhooks get no
-- subtree policy, and the config_entries policy admits no row with
-- sensitive = true. A key row holds a key hash, a webhook row holds a signing
-- secret hash and a URL that can carry credentials, and a sensitive config
-- row holds a secret value. Their 019 policies stay the only ones that admit
-- a tenant session, so only the exact tenant reads them. webhook_deliveries
-- is scoped through webhook_events, not webhooks, so it gives no subtree path
-- to a webhook row.
--
-- Tenant status does not affect the scope. Suspended, archived and pending
-- descendants are in the subtree, as exact-tenant RLS ignores status too.
-- Applications filter by status when they need to.
--
-- The bypass (app.bypass_rls = 'on') does not change: it sees every row.
--
-- The scope follows the tree as it is when the statement runs: a move through
-- moveTenant changes the subtree at once. The tree columns of tenants change
-- only under the bypass (see guard_tenant_tree_columns below), so a tenant
-- session cannot change its own position in the tree.
--
-- Cost: the function runs once per policy reference in a statement, and its
-- result grows with the size of the subtree. Each table then matches tenant_id
-- against that array, so it needs an index on tenant_id.

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
-- once per policy reference in a statement as an InitPlan and then matches
-- tenant_id against the array with the table's own index on tenant_id.
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
--
-- search_path is pinned below to pg_catalog, the schema this migration runs
-- in (where 001 created tenants), and pg_temp last, so that a table a session
-- creates cannot stand in for tenants.
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
  EXECUTE pg_catalog.format(
    'ALTER FUNCTION stratum_subtree_tenant_ids() SET search_path = pg_catalog, %I, pg_temp',
    pg_catalog.current_schema()
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

-- config_entries: non-sensitive rows only. A sensitive row holds a secret
-- value, so only the exact tenant reads it (019).
DROP POLICY IF EXISTS tenant_subtree_read ON config_entries;
CREATE POLICY tenant_subtree_read ON config_entries FOR SELECT
  USING (
    current_setting('app.tenant_scope', true) = 'subtree'
    AND tenant_id = ANY ((SELECT stratum_subtree_tenant_ids())::uuid[])
    AND NOT sensitive
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

-- webhooks: no subtree policy. A webhook row holds credential material, so
-- only the exact tenant reads it (019).
DROP POLICY IF EXISTS tenant_subtree_read ON webhooks;

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

-- ---------------------------------------------------------------------------
-- Tree columns change only under the bypass.
--
-- A tenant session may update its own tenants row (019), and the subtree read
-- above follows parent_id and ancestry_path. This BEFORE trigger refuses any
-- change to parent_id, ancestry_path, depth or ancestry_ltree unless
-- app.bypass_rls = 'on'. The library changes these columns only in
-- createTenant, moveTenant and the other tree operations, which all run under
-- the bypass (pool-helpers.ts), and so do the migrations. A role that skips
-- RLS must also set the bypass to change them.
--
-- A slug rename stays allowed: the trigger is named to run before
-- maintain_tenant_ancestry_ltree (BEFORE triggers run in name order), so it
-- compares the ancestry_ltree the statement wrote, not the one that trigger
-- recomputes from the new slug.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION refuse_tenant_tree_column_change()
RETURNS TRIGGER
AS $$
BEGIN
  IF current_setting('app.bypass_rls', true) IS DISTINCT FROM 'on' AND (
       NEW.parent_id IS DISTINCT FROM OLD.parent_id
    OR NEW.ancestry_path IS DISTINCT FROM OLD.ancestry_path
    OR NEW.depth IS DISTINCT FROM OLD.depth
    OR NEW.ancestry_ltree IS DISTINCT FROM OLD.ancestry_ltree
  ) THEN
    RAISE EXCEPTION 'tenant % tree columns (parent_id, ancestry_path, depth, ancestry_ltree) change only under app.bypass_rls', OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ language 'plpgsql';

DO $pin$ BEGIN
  EXECUTE pg_catalog.format(
    'ALTER FUNCTION refuse_tenant_tree_column_change() SET search_path = pg_catalog, %I, pg_temp',
    pg_catalog.current_schema()
  );
END $pin$;

DROP TRIGGER IF EXISTS guard_tenant_tree_columns ON tenants;
CREATE TRIGGER guard_tenant_tree_columns
  BEFORE UPDATE OF parent_id, ancestry_path, depth, ancestry_ltree ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION refuse_tenant_tree_column_change();

-- ---------------------------------------------------------------------------
-- refuse_tenant_parent_cycle() (029), with pg_temp last on its search_path.
--
-- The body is the one 029 created, unchanged. 029 pinned search_path to
-- pg_catalog and the migration schema; this adds pg_temp at the end, so the
-- cycle walk always reads the tenants table of that schema.
-- ---------------------------------------------------------------------------
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
    'ALTER FUNCTION refuse_tenant_parent_cycle() SET search_path = pg_catalog, %I, pg_temp',
    pg_catalog.current_schema()
  );
END $pin$;
