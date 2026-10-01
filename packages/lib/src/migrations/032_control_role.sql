-- Migration 032: The control role (opt-in hardening, 1.8).
--
-- Until now the library reached across tenants by setting app.bypass_rls in
-- its session, and the tenant_isolation policies of 019 and 020 admitted any
-- session that set it. A role that can run SQL can set that setting. This
-- migration adds the role-based model that replaces it:
--
--   * A NOLOGIN control role (default stratum_control). Each Stratum table
--     gets a stratum_control_plane policy FOR ALL TO that role. The login
--     role behind the library's adminPool is a member of it; the
--     application's login role is not. Membership is checked by PostgreSQL,
--     so a session cannot claim it by setting anything.
--   * The SECURITY DEFINER helpers (the subtree read of 031 and the cycle
--     guard of 029) are owned by the control role and no longer set
--     app.bypass_rls for their own duration.
--   * The tree-column guard of 031 accepts a member of the control role, or
--     the legacy bypass below.
--   * regions (T-11) gets row-level security like the other tables. It has no
--     tenant, so only the control role, or the legacy bypass, reaches it.
--
-- The legacy bypass stays on by default in 1.8, so nothing changes for a
-- deployment until it opts in. stratum_security holds one switch,
-- legacy_guc_bypass. While it is true, a session that sets app.bypass_rls
-- still passes tenant_isolation, as before. Setting it to false (only a
-- member of the control role can) closes that path: app.bypass_rls then
-- opens nothing. 2.0 removes the switch and the legacy branch.
--
-- Choosing the control role name. Roles are cluster-wide, so the name can be
-- set per database. The migration takes, in order:
--   1. the setting stratum.control_role, when the session sets it. The
--      library's migrate() and migrateAllSchemas() set it from their
--      controlRole option, and `ALTER DATABASE ... SET stratum.control_role`
--      sets it for every session of one database;
--   2. the role of the stratum_control_plane policies this database already
--      has, so a later schema (migrateAllSchemas) uses the same role;
--   3. stratum_control.
-- The name must be a plain lowercase identifier.
--
-- Privileges. The migration creates the control role when it does not exist
-- and grants it to the migrating role (current_user) WITH INHERIT TRUE, SET
-- TRUE (PostgreSQL 16 and later; earlier versions use a plain GRANT). That
-- needs CREATEROLE, or a database administrator who ran the bootstrap SQL
-- first. Without either, the migration stops with an error that prints that
-- SQL. A superuser needs no membership and gets none.
--
-- Safe to re-run, and safe in every tenant schema of migrateAllSchemas: every
-- object is created idempotently in the current schema, and the role section
-- takes an advisory lock so that concurrent schemas do not race to create it.

-- ---------------------------------------------------------------------------
-- The legacy switch.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stratum_security (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  legacy_guc_bypass BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- The row goes in before row-level security is turned on, so the migrating
-- role does not need the control policy yet.
INSERT INTO stratum_security (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
ALTER TABLE stratum_security ENABLE ROW LEVEL SECURITY;
ALTER TABLE stratum_security FORCE ROW LEVEL SECURITY;
REVOKE ALL ON stratum_security FROM PUBLIC;

-- stratum_legacy_bypass(): true when the session set app.bypass_rls = 'on'
-- and the legacy switch is on. SECURITY DEFINER, owned by the control role
-- (below), so it reads stratum_security through the control policy. It
-- returns false when the row is missing, so deleting the row also closes the
-- legacy path. Policies call it in a scalar subquery, so it runs once per
-- policy reference in a statement. Every role that queries a Stratum table
-- evaluates the policies, so EXECUTE stays granted to PUBLIC; the function
-- returns one boolean and gives no other access.
CREATE OR REPLACE FUNCTION stratum_legacy_bypass()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
BEGIN
  IF current_setting('app.bypass_rls', true) IS DISTINCT FROM 'on' THEN
    RETURN false;
  END IF;
  RETURN coalesce((SELECT s.legacy_guc_bypass FROM stratum_security s WHERE s.id), false);
END;
$$;

-- ---------------------------------------------------------------------------
-- tenant_isolation, re-created with the legacy bypass behind the switch.
-- The tenant scope of each policy is the one 019 and 020 created.
--   (SELECT stratum_legacy_bypass()) OR <scope>
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS tenant_isolation ON config_entries;
CREATE POLICY tenant_isolation ON config_entries FOR ALL
  USING ((SELECT stratum_legacy_bypass()) OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ((SELECT stratum_legacy_bypass()) OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON permission_policies;
CREATE POLICY tenant_isolation ON permission_policies FOR ALL
  USING ((SELECT stratum_legacy_bypass()) OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ((SELECT stratum_legacy_bypass()) OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON audit_logs;
CREATE POLICY tenant_isolation ON audit_logs FOR ALL
  USING ((SELECT stratum_legacy_bypass()) OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ((SELECT stratum_legacy_bypass()) OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON webhook_events;
CREATE POLICY tenant_isolation ON webhook_events FOR ALL
  USING ((SELECT stratum_legacy_bypass()) OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ((SELECT stratum_legacy_bypass()) OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON webhooks;
CREATE POLICY tenant_isolation ON webhooks FOR ALL
  USING ((SELECT stratum_legacy_bypass()) OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ((SELECT stratum_legacy_bypass()) OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON consent_records;
CREATE POLICY tenant_isolation ON consent_records FOR ALL
  USING ((SELECT stratum_legacy_bypass()) OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ((SELECT stratum_legacy_bypass()) OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON abac_policies;
CREATE POLICY tenant_isolation ON abac_policies FOR ALL
  USING ((SELECT stratum_legacy_bypass()) OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ((SELECT stratum_legacy_bypass()) OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON api_keys;
CREATE POLICY tenant_isolation ON api_keys FOR ALL
  USING ((SELECT stratum_legacy_bypass()) OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ((SELECT stratum_legacy_bypass()) OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON roles;
CREATE POLICY tenant_isolation ON roles FOR ALL
  USING ((SELECT stratum_legacy_bypass()) OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ((SELECT stratum_legacy_bypass()) OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON usage_events;
CREATE POLICY tenant_isolation ON usage_events FOR ALL
  USING ((SELECT stratum_legacy_bypass()) OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ((SELECT stratum_legacy_bypass()) OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON tenants;
CREATE POLICY tenant_isolation ON tenants FOR ALL
  USING ((SELECT stratum_legacy_bypass()) OR id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK ((SELECT stratum_legacy_bypass()) OR id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation ON webhook_deliveries;
CREATE POLICY tenant_isolation ON webhook_deliveries FOR ALL
  USING (
    (SELECT stratum_legacy_bypass())
    OR EXISTS (
      SELECT 1 FROM webhook_events we
      WHERE we.id = webhook_deliveries.event_id
        AND we.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    )
  )
  WITH CHECK (
    (SELECT stratum_legacy_bypass())
    OR EXISTS (
      SELECT 1 FROM webhook_events we
      WHERE we.id = webhook_deliveries.event_id
        AND we.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    )
  );

DROP POLICY IF EXISTS tenant_isolation ON principal_roles;
CREATE POLICY tenant_isolation ON principal_roles FOR ALL
  USING (
    (SELECT stratum_legacy_bypass())
    OR EXISTS (
      SELECT 1 FROM roles r
      WHERE r.id = principal_roles.role_id
        AND r.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    )
  )
  WITH CHECK (
    (SELECT stratum_legacy_bypass())
    OR EXISTS (
      SELECT 1 FROM roles r
      WHERE r.id = principal_roles.role_id
        AND r.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    )
  );

-- ---------------------------------------------------------------------------
-- regions (T-11): global infrastructure, no tenant. Only the control role and,
-- while the switch is on, the legacy bypass reach it.
-- ---------------------------------------------------------------------------
ALTER TABLE regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE regions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stratum_legacy_bypass ON regions;
CREATE POLICY stratum_legacy_bypass ON regions FOR ALL
  USING ((SELECT stratum_legacy_bypass()))
  WITH CHECK ((SELECT stratum_legacy_bypass()));

-- ---------------------------------------------------------------------------
-- The helpers, without SET app.* clauses. They become SECURITY DEFINER and
-- the control role owns them (below), so they read the whole tree through
-- the control policy, whatever the caller can see.
--
-- stratum_subtree_tenant_ids(): the body of 031. It no longer clears
-- app.tenant_scope, so its query on tenants is evaluated with the caller's
-- scope. That cannot recurse: the control role's policy is USING (true), and
-- PostgreSQL folds `true OR <tenant_subtree_read>` to true before it plans
-- the subquery that would call this function again. An integration test pins
-- this.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION stratum_subtree_tenant_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
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

-- refuse_tenant_parent_cycle(): the body of 029.
CREATE OR REPLACE FUNCTION refuse_tenant_parent_cycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
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
$$;

-- Trigger functions are not called directly; nobody needs EXECUTE on them.
REVOKE ALL ON FUNCTION refuse_tenant_parent_cycle() FROM PUBLIC;
REVOKE ALL ON FUNCTION refuse_tenant_tree_column_change() FROM PUBLIC;

-- No Stratum table is for PUBLIC.
REVOKE ALL ON tenants, config_entries, permission_policies, audit_logs, webhook_events,
  webhook_deliveries, webhooks, consent_records, abac_policies, api_keys, roles,
  principal_roles, usage_events, regions FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- The control role and everything that names it.
-- ---------------------------------------------------------------------------
DO $control$
DECLARE
  v_schema text := current_schema();
  v_role text := NULLIF(current_setting('stratum.control_role', true), '');
  v_existing text[];
  v_pg16 boolean := current_setting('server_version_num')::int >= 160000;
  v_bootstrap text;
  v_table text;
  v_tables text[] := ARRAY[
    'tenants', 'config_entries', 'permission_policies', 'audit_logs', 'webhook_events',
    'webhook_deliveries', 'webhooks', 'consent_records', 'abac_policies', 'api_keys',
    'roles', 'principal_roles', 'usage_events', 'regions', 'stratum_security'
  ];
BEGIN
  SELECT array_agg(DISTINCT r::text) INTO v_existing
    FROM pg_policies p, unnest(p.roles) r
   WHERE p.policyname = 'stratum_control_plane';

  IF v_role IS NULL THEN
    v_role := CASE WHEN cardinality(v_existing) = 1 THEN v_existing[1] ELSE 'stratum_control' END;
  END IF;
  IF v_role !~ '^[a-z_][a-z0-9_]{0,62}$' THEN
    RAISE EXCEPTION 'stratum.control_role must be a plain lowercase identifier, got "%"', v_role
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF cardinality(v_existing) > 0 AND v_existing <> ARRAY[v_role] THEN
    RAISE EXCEPTION 'this database already uses the control role %, not "%"; set stratum.control_role to match',
      v_existing, v_role
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_bootstrap := format('CREATE ROLE %I NOLOGIN;', v_role) || E'\n' ||
    CASE WHEN v_pg16
      THEN format('GRANT %I TO %I WITH INHERIT TRUE, SET TRUE;', v_role, current_user)
      ELSE format('GRANT %I TO %I;', v_role, current_user)
    END || E'\n' ||
    format('GRANT USAGE, CREATE ON SCHEMA %I TO %I;', v_schema, v_role);

  -- Roles are cluster-wide; serialize their creation within this database.
  PERFORM pg_advisory_xact_lock(hashtext('stratum.control_role'));

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
    BEGIN
      EXECUTE format('CREATE ROLE %I NOLOGIN', v_role);
    EXCEPTION
      WHEN duplicate_object OR unique_violation THEN
        NULL; -- created concurrently, by another database's migration
      WHEN insufficient_privilege THEN
        RAISE EXCEPTION E'Stratum migration 032 needs the control role "%", and role "%" cannot create it. Ask a database administrator to run this once, then migrate again:\n%',
          v_role, current_user, v_bootstrap
          USING ERRCODE = 'insufficient_privilege';
    END;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role AND (rolcanlogin OR rolsuper OR rolbypassrls)) THEN
    RAISE WARNING 'control role "%" should be NOLOGIN NOSUPERUSER NOBYPASSRLS', v_role;
  END IF;

  IF NOT pg_has_role(current_user, v_role, 'USAGE') OR (v_pg16 AND NOT pg_has_role(current_user, v_role, 'SET')) THEN
    BEGIN
      IF v_pg16 THEN
        EXECUTE format('GRANT %I TO %I WITH INHERIT TRUE, SET TRUE', v_role, current_user);
      ELSE
        EXECUTE format('GRANT %I TO %I', v_role, current_user);
      END IF;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE EXCEPTION E'Stratum migration 032 needs role "%" to be a member of the control role "%", and it cannot grant that itself. Ask a database administrator to run this once, then migrate again:\n%',
        current_user, v_role, v_bootstrap
        USING ERRCODE = 'insufficient_privilege';
    END;
    IF NOT pg_has_role(current_user, v_role, 'USAGE') THEN
      RAISE EXCEPTION 'role "%" is a member of the control role "%" but does not inherit its privileges (NOINHERIT); use a role with INHERIT to migrate',
        current_user, v_role
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- The control role owns the helpers below, so it needs the schema and the
  -- tables they read. It gets the same rights on every Stratum table, so that
  -- membership in it is all the library's admin login needs.
  BEGIN
    EXECUTE format('GRANT USAGE, CREATE ON SCHEMA %I TO %I', v_schema, v_role);
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION E'Stratum migration 032 cannot grant the control role "%" USAGE and CREATE on schema "%". Ask a database administrator to run this once, then migrate again:\n%',
      v_role, v_schema, v_bootstrap
      USING ERRCODE = 'insufficient_privilege';
  END;

  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I.%I TO %I', v_schema, v_table, v_role);
    EXECUTE format('DROP POLICY IF EXISTS stratum_control_plane ON %I.%I', v_schema, v_table);
    EXECUTE format(
      'CREATE POLICY stratum_control_plane ON %I.%I AS PERMISSIVE FOR ALL TO %I USING (true) WITH CHECK (true)',
      v_schema, v_table, v_role
    );
  END LOOP;

  -- The tree-column guard of 031, which now accepts a member of the control
  -- role. It is not SECURITY DEFINER: it checks the role that runs the
  -- statement. pg_has_role(..., 'USAGE') is true for a member that inherits
  -- the role's privileges and for a superuser.
  EXECUTE format($fn$
    CREATE OR REPLACE FUNCTION refuse_tenant_tree_column_change()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $body$
    BEGIN
      IF (
           NEW.parent_id IS DISTINCT FROM OLD.parent_id
        OR NEW.ancestry_path IS DISTINCT FROM OLD.ancestry_path
        OR NEW.depth IS DISTINCT FROM OLD.depth
        OR NEW.ancestry_ltree IS DISTINCT FROM OLD.ancestry_ltree
      ) AND NOT pg_has_role(current_user, %L, 'USAGE')
        AND NOT (SELECT stratum_legacy_bypass()) THEN
        RAISE EXCEPTION 'tenant %% tree columns (parent_id, ancestry_path, depth, ancestry_ltree) change only through the Stratum control role', OLD.id
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      RETURN NEW;
    END;
    $body$
  $fn$, v_role);

  EXECUTE format('ALTER FUNCTION %I.stratum_legacy_bypass() SET search_path = pg_catalog, %I, pg_temp', v_schema, v_schema);
  EXECUTE format('ALTER FUNCTION %I.stratum_subtree_tenant_ids() SET search_path = pg_catalog, %I, pg_temp', v_schema, v_schema);
  EXECUTE format('ALTER FUNCTION %I.refuse_tenant_parent_cycle() SET search_path = pg_catalog, %I, pg_temp', v_schema, v_schema);
  EXECUTE format('ALTER FUNCTION %I.refuse_tenant_tree_column_change() SET search_path = pg_catalog, %I, pg_temp', v_schema, v_schema);

  EXECUTE format('ALTER FUNCTION %I.stratum_legacy_bypass() OWNER TO %I', v_schema, v_role);
  EXECUTE format('ALTER FUNCTION %I.stratum_subtree_tenant_ids() OWNER TO %I', v_schema, v_role);
  EXECUTE format('ALTER FUNCTION %I.refuse_tenant_parent_cycle() OWNER TO %I', v_schema, v_role);
END
$control$;
