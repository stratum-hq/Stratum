-- Migration 032: The control role (opt-in hardening, 1.8).
--
-- Until now the library reached across tenants by setting app.bypass_rls in
-- its session, and the tenant_isolation policies of 019 and 020 admitted a
-- session that set it. This migration adds a role-based model, in which
-- membership in a PostgreSQL role decides which sessions reach rows across
-- tenants. It comes in two parts.
--
-- Part 1 needs no new role and always applies:
--   * stratum_security holds one switch, legacy_guc_bypass, true by default
--     in 1.8. While it is true, a session that sets app.bypass_rls still
--     passes tenant_isolation, as before. Setting it to false closes that
--     path. 2.0 removes the switch and the legacy branch.
--   * tenant_isolation on the 13 tables of 019 and 020 is re-created as
--     (SELECT stratum_legacy_bypass()) OR <the same tenant scope>.
--   * regions (T-11) gets row-level security. It has no tenant, so only the
--     legacy bypass and, once applied, the control role reach it.
--   * PUBLIC loses every privilege on the Stratum tables and the trigger
--     functions.
--
-- Part 2, stratum_apply_control_role(role_name, target_schema), applies the
-- control role. It is defined here and called at the end of this migration,
-- and it is idempotent, so `stratum db roles` and the bootstrap SQL can call
-- it again later:
--   * A NOLOGIN control role (default stratum_control), created when missing
--     and granted to the caller. Each Stratum table gets a
--     stratum_control_plane policy FOR ALL TO that role. The login behind the
--     library's adminPool is a member of it; the application's login is not.
--     Membership is checked by PostgreSQL, so a session cannot claim it by
--     setting anything.
--   * The SECURITY DEFINER helpers (the subtree read of 031 and the cycle
--     guard of 029) are re-created without their SET app.* clauses and owned
--     by the control role.
--   * The tree-column guard of 031 accepts a member of the control role, or
--     the legacy bypass.
--   * Row-level security is reset on every Stratum table: all its policies
--     are dropped, RLS is enabled and forced (stratum_security included), and
--     the canonical policies are created again. Running it restores policies
--     that an owner of the tables changed, dropped or added.
--
-- Part 2 grants the control role to the migrating role, which must be the
-- library's admin login and not the application's. So the migration applies
-- it only with an explicit opt-in (the setting stratum.apply_control_role,
-- see the end of this file), or when that grants nothing new. When it does
-- not apply it, or the migrating role can neither create nor join the
-- control role (no CREATEROLE, no ADMIN on an existing role), part 2 is
-- skipped with a WARNING that prints the bootstrap SQL, and the migration
-- still succeeds.
-- The install then behaves as before 1.8 until an administrator runs that
-- SQL; Stratum.initialize() reports the hardening as not active.
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
INSERT INTO stratum_security (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
-- Row-level security without FORCE: no other role reads or writes the table,
-- but its owner still can, so stratum_legacy_bypass() (SECURITY DEFINER,
-- owned by the migrating role until the control role takes it over) reads it
-- before the control role is applied. stratum_apply_control_role() turns on
-- FORCE.
ALTER TABLE stratum_security ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON stratum_security FROM PUBLIC;

-- stratum_legacy_bypass(): true when the session set app.bypass_rls = 'on'
-- and the legacy switch is on. SECURITY DEFINER, so it reads stratum_security
-- as its owner: the migrating role, then the control role once applied. It
-- returns false when the row is missing, so deleting the row also closes the
-- legacy path. Policies call it in a scalar subquery, so it runs once per
-- policy reference in a statement. Every role that queries a Stratum table
-- evaluates the policies, so EXECUTE stays granted to PUBLIC; the function
-- returns one boolean and gives no other access.
DO $create$ BEGIN
  EXECUTE pg_catalog.format($fn$
CREATE OR REPLACE FUNCTION %1$I.stratum_legacy_bypass()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $body$
BEGIN
  IF pg_catalog.current_setting('app.bypass_rls', true) IS DISTINCT FROM 'on' THEN
    RETURN false;
  END IF;
  RETURN coalesce((SELECT s.legacy_guc_bypass FROM %1$I.stratum_security s WHERE s.id), false);
END;
$body$
$fn$, pg_catalog.current_schema());
END $create$;

-- stratum_subtree_tenant_ids() as migration 031 left it for a migrating
-- role that is not a superuser: the runner dropped its SET app.* clauses
-- (see migration-sql.ts in @stratum-hq/lib), so it ran with the caller's
-- app.tenant_scope, and its read of tenants, under tenant_subtree_read,
-- could call it again. Until stratum_apply_control_role() re-creates it,
-- this version clears app.tenant_scope around that read and restores it.
-- A version that still has its SET app.* clauses, or that another role
-- owns, is left as it is.
DO $subtree$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
     WHERE p.pronamespace = pg_catalog.current_schema()::regnamespace
       AND p.proname = 'stratum_subtree_tenant_ids' AND p.pronargs = 0
       AND NOT p.prosecdef
       AND NOT EXISTS (SELECT 1 FROM pg_catalog.unnest(p.proconfig) c WHERE c LIKE 'app.%')
       AND pg_catalog.pg_has_role(current_user, p.proowner, 'USAGE')
  ) THEN
    EXECUTE pg_catalog.format($fn$
CREATE OR REPLACE FUNCTION %1$I.stratum_subtree_tenant_ids()
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, pg_temp
AS $body$
DECLARE
  v_scope text := pg_catalog.current_setting('app.tenant_scope', true);
  v_ids uuid[];
BEGIN
  PERFORM pg_catalog.set_config('app.tenant_scope', '', true);
  WITH cur AS (
    SELECT t.id, pg_catalog.rtrim(t.ancestry_path, '/') || '/' || t.id::text AS sub
    FROM %1$I.tenants t
    WHERE t.id = NULLIF(pg_catalog.current_setting('app.current_tenant_id', true), '')::uuid
  )
  SELECT coalesce(pg_catalog.array_agg(s.id), '{}'::uuid[]) INTO v_ids
  FROM (
    SELECT cur.id FROM cur
    UNION ALL
    SELECT d.id
    FROM cur
    JOIN %1$I.tenants d
      ON d.ancestry_path OPERATOR(pg_catalog.~>=~) cur.sub
     AND d.ancestry_path OPERATOR(pg_catalog.~<~) (cur.sub || '0')
     AND (d.ancestry_path = cur.sub OR d.ancestry_path LIKE cur.sub || '/%%')
  ) s;
  PERFORM pg_catalog.set_config('app.tenant_scope', coalesce(v_scope, ''), true);
  RETURN v_ids;
END;
$body$
$fn$, pg_catalog.current_schema());
  END IF;
END $subtree$;

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

-- Trigger functions are not called directly; nobody needs EXECUTE on them.
REVOKE ALL ON FUNCTION refuse_tenant_parent_cycle() FROM PUBLIC;
REVOKE ALL ON FUNCTION refuse_tenant_tree_column_change() FROM PUBLIC;

-- No Stratum table is for PUBLIC.
REVOKE ALL ON tenants, config_entries, permission_policies, audit_logs, webhook_events,
  webhook_deliveries, webhooks, consent_records, abac_policies, api_keys, roles,
  principal_roles, usage_events, regions FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Part 2: stratum_apply_control_role(role_name, target_schema).
--
-- SECURITY INVOKER: the caller must own the Stratum tables of target_schema
-- (or be a superuser) and be able to create or join the role. EXECUTE is
-- revoked from PUBLIC. It raises insufficient_privilege, with the bootstrap
-- SQL in the message, when the caller can neither create nor join the role.
--
-- It and the functions it creates run with search_path = pg_catalog,
-- pg_temp, and name every Stratum object with its schema, so that objects
-- other roles create in the Stratum schema are never resolved in them. It
-- applies the control role only to the schema it lives in, and it revokes
-- CREATE on that schema from PUBLIC.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION stratum_apply_control_role(role_name text, target_schema text)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $apply$
DECLARE
  v_role text := role_name;
  v_schema text := target_schema;
  v_context text;
  v_existing text[];
  v_pg16 boolean := pg_catalog.current_setting('server_version_num')::int >= 160000;
  v_bootstrap text;
  v_table text;
  v_policy name;
  v_tables text[] := ARRAY[
    'tenants', 'config_entries', 'permission_policies', 'audit_logs', 'webhook_events',
    'webhook_deliveries', 'webhooks', 'consent_records', 'abac_policies', 'api_keys',
    'roles', 'principal_roles', 'usage_events', 'regions', 'stratum_security'
  ];
BEGIN
  IF v_role IS NULL OR v_role !~ '^[a-z_][a-z0-9_]{0,62}$' THEN
    RAISE EXCEPTION 'the control role must be a plain lowercase identifier, got "%"', v_role
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF pg_catalog.to_regnamespace(pg_catalog.quote_ident(v_schema)) IS NULL THEN
    RAISE EXCEPTION 'schema "%" does not exist', v_schema USING ERRCODE = 'invalid_schema_name';
  END IF;
  -- The first context line names this function. Its schema is not on the
  -- search path, so PostgreSQL prints the name qualified with it.
  GET DIAGNOSTICS v_context = PG_CONTEXT;
  IF pg_catalog.strpos(pg_catalog.split_part(v_context, E'\n', 1),
       'function ' || pg_catalog.quote_ident(v_schema) || '.stratum_apply_control_role(text,text) ') = 0 THEN
    RAISE EXCEPTION 'stratum_apply_control_role applies the control role only to the schema it is in, not to "%"', v_schema
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT pg_catalog.array_agg(DISTINCT r::text) INTO v_existing
    FROM pg_catalog.pg_policies p, pg_catalog.unnest(p.roles) r
   WHERE p.policyname = 'stratum_control_plane';
  IF pg_catalog.cardinality(v_existing) > 0 AND v_existing OPERATOR(pg_catalog.<>) ARRAY[v_role] THEN
    RAISE EXCEPTION 'this database already uses the control role %, not "%"', v_existing, v_role
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_bootstrap := pg_catalog.format('CREATE ROLE %I NOLOGIN;', v_role) || E'\n' ||
    CASE WHEN v_pg16
      THEN pg_catalog.format('GRANT %I TO %I WITH INHERIT TRUE, SET TRUE;', v_role, current_user)
      ELSE pg_catalog.format('GRANT %I TO %I;', v_role, current_user)
    END || E'\n' ||
    pg_catalog.format('SELECT %I.stratum_apply_control_role(%L, %L);', v_schema, v_role, v_schema);

  -- Roles are cluster-wide; serialize their creation within this database.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('stratum.control_role'));

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role) THEN
    BEGIN
      EXECUTE pg_catalog.format('CREATE ROLE %I NOLOGIN', v_role);
    EXCEPTION
      WHEN duplicate_object OR unique_violation THEN
        NULL; -- created concurrently, by another database's migration
      WHEN insufficient_privilege THEN
        RAISE EXCEPTION E'role "%" cannot create the Stratum control role "%". Run this once as a superuser:\n%',
          current_user, v_role, v_bootstrap
          USING ERRCODE = 'insufficient_privilege';
    END;
  END IF;

  -- The control role passes every Stratum policy, so it must not be usable
  -- as a login, and must not carry attributes that bypass the policies.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role AND (rolcanlogin OR rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'the control role "%" must be NOLOGIN NOSUPERUSER NOBYPASSRLS; run ALTER ROLE % NOLOGIN NOSUPERUSER NOBYPASSRLS and apply it again',
      v_role, pg_catalog.quote_ident(v_role)
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF NOT pg_catalog.pg_has_role(current_user, v_role, 'USAGE') OR (v_pg16 AND NOT pg_catalog.pg_has_role(current_user, v_role, 'SET')) THEN
    BEGIN
      IF v_pg16 THEN
        EXECUTE pg_catalog.format('GRANT %I TO %I WITH INHERIT TRUE, SET TRUE', v_role, current_user);
      ELSE
        EXECUTE pg_catalog.format('GRANT %I TO %I', v_role, current_user);
      END IF;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE EXCEPTION E'role "%" is not a member of the Stratum control role "%" and cannot grant that itself. Run this once as a superuser:\n%',
        current_user, v_role, v_bootstrap
        USING ERRCODE = 'insufficient_privilege';
    END;
    IF NOT pg_catalog.pg_has_role(current_user, v_role, 'USAGE') THEN
      RAISE EXCEPTION 'role "%" is a member of the control role "%" but does not inherit its privileges (NOINHERIT)',
        current_user, v_role
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- The control role owns the helpers below, so it needs the schema and the
  -- tables they read. It gets the same rights on every Stratum table, so that
  -- membership in it is all the library's admin login needs.
  BEGIN
    EXECUTE pg_catalog.format('GRANT USAGE, CREATE ON SCHEMA %I TO %I', v_schema, v_role);
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION E'role "%" cannot grant the control role "%" USAGE and CREATE on schema "%". Run this once as a superuser:\n%',
      current_user, v_role, v_schema, v_bootstrap
      USING ERRCODE = 'insufficient_privilege';
  END;
  -- Only roles granted CREATE by name may create objects in the schema.
  EXECUTE pg_catalog.format('REVOKE CREATE ON SCHEMA %I FROM PUBLIC', v_schema);

  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE pg_catalog.format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I.%I TO %I', v_schema, v_table, v_role);
  END LOOP;

  -- Row-level security of the Stratum tables, reset to the canonical set:
  -- every policy on them is dropped, RLS is enabled and forced, and the
  -- policies of 019, 020, 031 and 032 (in its legacy form) are created again,
  -- with stratum_control_plane for the control role. Whatever a former owner
  -- of the tables changed or added is gone afterwards. The statements below
  -- are rendered by policiesPlpgsql() in @stratum-hq/lib (stratum-policies.ts);
  -- a unit test keeps the two identical.
  FOREACH v_table IN ARRAY v_tables LOOP
    FOR v_policy IN
      SELECT p.polname FROM pg_policy p WHERE p.polrelid = format('%I.%I', v_schema, v_table)::regclass
    LOOP
      EXECUTE format('DROP POLICY %I ON %I.%I', v_policy, v_schema, v_table);
    END LOOP;
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', v_schema, v_table);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', v_schema, v_table);
  END LOOP;
  EXECUTE format($pol$CREATE POLICY tenant_isolation ON %1$I.config_entries FOR ALL USING ((SELECT %1$I.stratum_legacy_bypass()) OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) WITH CHECK ((SELECT %1$I.stratum_legacy_bypass()) OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)$pol$, v_schema);
  EXECUTE format($pol$CREATE POLICY tenant_isolation ON %1$I.permission_policies FOR ALL USING ((SELECT %1$I.stratum_legacy_bypass()) OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) WITH CHECK ((SELECT %1$I.stratum_legacy_bypass()) OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)$pol$, v_schema);
  EXECUTE format($pol$CREATE POLICY tenant_isolation ON %1$I.audit_logs FOR ALL USING ((SELECT %1$I.stratum_legacy_bypass()) OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) WITH CHECK ((SELECT %1$I.stratum_legacy_bypass()) OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)$pol$, v_schema);
  EXECUTE format($pol$CREATE POLICY tenant_isolation ON %1$I.webhook_events FOR ALL USING ((SELECT %1$I.stratum_legacy_bypass()) OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) WITH CHECK ((SELECT %1$I.stratum_legacy_bypass()) OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)$pol$, v_schema);
  EXECUTE format($pol$CREATE POLICY tenant_isolation ON %1$I.webhooks FOR ALL USING ((SELECT %1$I.stratum_legacy_bypass()) OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) WITH CHECK ((SELECT %1$I.stratum_legacy_bypass()) OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)$pol$, v_schema);
  EXECUTE format($pol$CREATE POLICY tenant_isolation ON %1$I.consent_records FOR ALL USING ((SELECT %1$I.stratum_legacy_bypass()) OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) WITH CHECK ((SELECT %1$I.stratum_legacy_bypass()) OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)$pol$, v_schema);
  EXECUTE format($pol$CREATE POLICY tenant_isolation ON %1$I.abac_policies FOR ALL USING ((SELECT %1$I.stratum_legacy_bypass()) OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) WITH CHECK ((SELECT %1$I.stratum_legacy_bypass()) OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)$pol$, v_schema);
  EXECUTE format($pol$CREATE POLICY tenant_isolation ON %1$I.api_keys FOR ALL USING ((SELECT %1$I.stratum_legacy_bypass()) OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) WITH CHECK ((SELECT %1$I.stratum_legacy_bypass()) OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)$pol$, v_schema);
  EXECUTE format($pol$CREATE POLICY tenant_isolation ON %1$I.roles FOR ALL USING ((SELECT %1$I.stratum_legacy_bypass()) OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) WITH CHECK ((SELECT %1$I.stratum_legacy_bypass()) OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)$pol$, v_schema);
  EXECUTE format($pol$CREATE POLICY tenant_isolation ON %1$I.usage_events FOR ALL USING ((SELECT %1$I.stratum_legacy_bypass()) OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) WITH CHECK ((SELECT %1$I.stratum_legacy_bypass()) OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)$pol$, v_schema);
  EXECUTE format($pol$CREATE POLICY tenant_isolation ON %1$I.tenants FOR ALL USING ((SELECT %1$I.stratum_legacy_bypass()) OR id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid) WITH CHECK ((SELECT %1$I.stratum_legacy_bypass()) OR id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)$pol$, v_schema);
  EXECUTE format($pol$CREATE POLICY tenant_isolation ON %1$I.webhook_deliveries FOR ALL USING ((SELECT %1$I.stratum_legacy_bypass()) OR EXISTS (SELECT 1 FROM %1$I.webhook_events we WHERE we.id = webhook_deliveries.event_id AND we.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)) WITH CHECK ((SELECT %1$I.stratum_legacy_bypass()) OR EXISTS (SELECT 1 FROM %1$I.webhook_events we WHERE we.id = webhook_deliveries.event_id AND we.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))$pol$, v_schema);
  EXECUTE format($pol$CREATE POLICY tenant_isolation ON %1$I.principal_roles FOR ALL USING ((SELECT %1$I.stratum_legacy_bypass()) OR EXISTS (SELECT 1 FROM %1$I.roles r WHERE r.id = principal_roles.role_id AND r.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)) WITH CHECK ((SELECT %1$I.stratum_legacy_bypass()) OR EXISTS (SELECT 1 FROM %1$I.roles r WHERE r.id = principal_roles.role_id AND r.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid))$pol$, v_schema);
  EXECUTE format($pol$CREATE POLICY tenant_subtree_read ON %1$I.config_entries FOR SELECT USING (current_setting('app.tenant_scope', true) = 'subtree' AND tenant_id = ANY ((SELECT %1$I.stratum_subtree_tenant_ids())::uuid[]) AND NOT sensitive)$pol$, v_schema);
  EXECUTE format($pol$CREATE POLICY tenant_subtree_read ON %1$I.permission_policies FOR SELECT USING (current_setting('app.tenant_scope', true) = 'subtree' AND tenant_id = ANY ((SELECT %1$I.stratum_subtree_tenant_ids())::uuid[]))$pol$, v_schema);
  EXECUTE format($pol$CREATE POLICY tenant_subtree_read ON %1$I.audit_logs FOR SELECT USING (current_setting('app.tenant_scope', true) = 'subtree' AND tenant_id = ANY ((SELECT %1$I.stratum_subtree_tenant_ids())::uuid[]))$pol$, v_schema);
  EXECUTE format($pol$CREATE POLICY tenant_subtree_read ON %1$I.webhook_events FOR SELECT USING (current_setting('app.tenant_scope', true) = 'subtree' AND tenant_id = ANY ((SELECT %1$I.stratum_subtree_tenant_ids())::uuid[]))$pol$, v_schema);
  EXECUTE format($pol$CREATE POLICY tenant_subtree_read ON %1$I.consent_records FOR SELECT USING (current_setting('app.tenant_scope', true) = 'subtree' AND tenant_id = ANY ((SELECT %1$I.stratum_subtree_tenant_ids())::uuid[]))$pol$, v_schema);
  EXECUTE format($pol$CREATE POLICY tenant_subtree_read ON %1$I.abac_policies FOR SELECT USING (current_setting('app.tenant_scope', true) = 'subtree' AND tenant_id = ANY ((SELECT %1$I.stratum_subtree_tenant_ids())::uuid[]))$pol$, v_schema);
  EXECUTE format($pol$CREATE POLICY tenant_subtree_read ON %1$I.roles FOR SELECT USING (current_setting('app.tenant_scope', true) = 'subtree' AND tenant_id = ANY ((SELECT %1$I.stratum_subtree_tenant_ids())::uuid[]))$pol$, v_schema);
  EXECUTE format($pol$CREATE POLICY tenant_subtree_read ON %1$I.usage_events FOR SELECT USING (current_setting('app.tenant_scope', true) = 'subtree' AND tenant_id = ANY ((SELECT %1$I.stratum_subtree_tenant_ids())::uuid[]))$pol$, v_schema);
  EXECUTE format($pol$CREATE POLICY tenant_subtree_read ON %1$I.tenants FOR SELECT USING (current_setting('app.tenant_scope', true) = 'subtree' AND id = ANY ((SELECT %1$I.stratum_subtree_tenant_ids())::uuid[]))$pol$, v_schema);
  EXECUTE format($pol$CREATE POLICY tenant_subtree_read ON %1$I.webhook_deliveries FOR SELECT USING (current_setting('app.tenant_scope', true) = 'subtree' AND EXISTS (SELECT 1 FROM %1$I.webhook_events we WHERE we.id = webhook_deliveries.event_id AND we.tenant_id = ANY ((SELECT %1$I.stratum_subtree_tenant_ids())::uuid[])))$pol$, v_schema);
  EXECUTE format($pol$CREATE POLICY tenant_subtree_read ON %1$I.principal_roles FOR SELECT USING (current_setting('app.tenant_scope', true) = 'subtree' AND EXISTS (SELECT 1 FROM %1$I.roles r WHERE r.id = principal_roles.role_id AND r.tenant_id = ANY ((SELECT %1$I.stratum_subtree_tenant_ids())::uuid[])))$pol$, v_schema);
  EXECUTE format($pol$CREATE POLICY stratum_legacy_bypass ON %1$I.regions FOR ALL USING ((SELECT %1$I.stratum_legacy_bypass())) WITH CHECK ((SELECT %1$I.stratum_legacy_bypass()))$pol$, v_schema);
  EXECUTE format($pol$CREATE POLICY stratum_control_plane ON %1$I.tenants AS PERMISSIVE FOR ALL TO %2$I USING (true) WITH CHECK (true)$pol$, v_schema, v_role);
  EXECUTE format($pol$CREATE POLICY stratum_control_plane ON %1$I.config_entries AS PERMISSIVE FOR ALL TO %2$I USING (true) WITH CHECK (true)$pol$, v_schema, v_role);
  EXECUTE format($pol$CREATE POLICY stratum_control_plane ON %1$I.permission_policies AS PERMISSIVE FOR ALL TO %2$I USING (true) WITH CHECK (true)$pol$, v_schema, v_role);
  EXECUTE format($pol$CREATE POLICY stratum_control_plane ON %1$I.audit_logs AS PERMISSIVE FOR ALL TO %2$I USING (true) WITH CHECK (true)$pol$, v_schema, v_role);
  EXECUTE format($pol$CREATE POLICY stratum_control_plane ON %1$I.webhook_events AS PERMISSIVE FOR ALL TO %2$I USING (true) WITH CHECK (true)$pol$, v_schema, v_role);
  EXECUTE format($pol$CREATE POLICY stratum_control_plane ON %1$I.webhook_deliveries AS PERMISSIVE FOR ALL TO %2$I USING (true) WITH CHECK (true)$pol$, v_schema, v_role);
  EXECUTE format($pol$CREATE POLICY stratum_control_plane ON %1$I.webhooks AS PERMISSIVE FOR ALL TO %2$I USING (true) WITH CHECK (true)$pol$, v_schema, v_role);
  EXECUTE format($pol$CREATE POLICY stratum_control_plane ON %1$I.consent_records AS PERMISSIVE FOR ALL TO %2$I USING (true) WITH CHECK (true)$pol$, v_schema, v_role);
  EXECUTE format($pol$CREATE POLICY stratum_control_plane ON %1$I.abac_policies AS PERMISSIVE FOR ALL TO %2$I USING (true) WITH CHECK (true)$pol$, v_schema, v_role);
  EXECUTE format($pol$CREATE POLICY stratum_control_plane ON %1$I.api_keys AS PERMISSIVE FOR ALL TO %2$I USING (true) WITH CHECK (true)$pol$, v_schema, v_role);
  EXECUTE format($pol$CREATE POLICY stratum_control_plane ON %1$I.roles AS PERMISSIVE FOR ALL TO %2$I USING (true) WITH CHECK (true)$pol$, v_schema, v_role);
  EXECUTE format($pol$CREATE POLICY stratum_control_plane ON %1$I.principal_roles AS PERMISSIVE FOR ALL TO %2$I USING (true) WITH CHECK (true)$pol$, v_schema, v_role);
  EXECUTE format($pol$CREATE POLICY stratum_control_plane ON %1$I.usage_events AS PERMISSIVE FOR ALL TO %2$I USING (true) WITH CHECK (true)$pol$, v_schema, v_role);
  EXECUTE format($pol$CREATE POLICY stratum_control_plane ON %1$I.regions AS PERMISSIVE FOR ALL TO %2$I USING (true) WITH CHECK (true)$pol$, v_schema, v_role);
  EXECUTE format($pol$CREATE POLICY stratum_control_plane ON %1$I.stratum_security AS PERMISSIVE FOR ALL TO %2$I USING (true) WITH CHECK (true)$pol$, v_schema, v_role);

  -- stratum_legacy_bypass(): as part 1 of this migration creates it. Created
  -- again here so that its body and settings are the migration's, whoever
  -- owned it before.
  EXECUTE pg_catalog.format($fn$
CREATE OR REPLACE FUNCTION %1$I.stratum_legacy_bypass()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $body$
BEGIN
  IF pg_catalog.current_setting('app.bypass_rls', true) IS DISTINCT FROM 'on' THEN
    RETURN false;
  END IF;
  RETURN coalesce((SELECT s.legacy_guc_bypass FROM %1$I.stratum_security s WHERE s.id), false);
END;
$body$
$fn$, v_schema);

  -- stratum_subtree_tenant_ids(): the body of 031, SECURITY DEFINER, without
  -- the SET app.* clauses. It no longer clears app.tenant_scope, so its query
  -- on tenants is evaluated with the caller's scope. That cannot recurse: the
  -- control role's policy is USING (true), and PostgreSQL folds
  -- `true OR <tenant_subtree_read>` to true before it plans the subquery that
  -- would call this function again. An integration test pins this.
  EXECUTE pg_catalog.format($fn$
    CREATE OR REPLACE FUNCTION %1$I.stratum_subtree_tenant_ids()
    RETURNS uuid[]
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
    AS $body$
  WITH cur AS (
    SELECT t.id, pg_catalog.rtrim(t.ancestry_path, '/') || '/' || t.id::text AS sub
    FROM %1$I.tenants t
    WHERE t.id = NULLIF(pg_catalog.current_setting('app.current_tenant_id', true), '')::uuid
  )
  SELECT coalesce(pg_catalog.array_agg(s.id), '{}'::uuid[])
  FROM (
    SELECT cur.id FROM cur
    UNION ALL
    SELECT d.id
    FROM cur
    JOIN %1$I.tenants d
      ON d.ancestry_path OPERATOR(pg_catalog.~>=~) cur.sub
     AND d.ancestry_path OPERATOR(pg_catalog.~<~) (cur.sub || '0')
     AND (d.ancestry_path = cur.sub OR d.ancestry_path LIKE cur.sub || '/%%')
  ) s
    $body$
  $fn$, v_schema);

  -- refuse_tenant_parent_cycle(): the body of 029, SECURITY DEFINER, without
  -- the SET clause.
  EXECUTE pg_catalog.format($fn$
    CREATE OR REPLACE FUNCTION %1$I.refuse_tenant_parent_cycle()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp
    AS $body$
BEGIN
  IF NEW.parent_id = NEW.id OR EXISTS (
    WITH RECURSIVE up(id, parent_id, seen) AS (
      SELECT t.id, t.parent_id, ARRAY[t.id]
      FROM %1$I.tenants t
      WHERE t.id = NEW.parent_id
      UNION ALL
      SELECT t.id, t.parent_id, up.seen OPERATOR(pg_catalog.||) t.id
      FROM %1$I.tenants t
      JOIN up ON t.id = up.parent_id
      WHERE t.id OPERATOR(pg_catalog.<>) ALL (up.seen)
    )
    SELECT 1 FROM up WHERE up.id = NEW.id
  ) THEN
    RAISE EXCEPTION 'tenant %% cannot be its own ancestor (parent_id cycle)', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
    $body$
  $fn$, v_schema);

  -- The tree-column guard of 031, which now accepts a member of the control
  -- role. It is not SECURITY DEFINER: it checks the role that runs the
  -- statement. pg_has_role(..., 'USAGE') is true for a member that inherits
  -- the role's privileges and for a superuser. ancestry_ltree is compared as
  -- text, because the ltree operators are not on its search path.
  EXECUTE pg_catalog.format($fn$
    CREATE OR REPLACE FUNCTION %1$I.refuse_tenant_tree_column_change()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SET search_path = pg_catalog, pg_temp
    AS $body$
    BEGIN
      IF (
           NEW.parent_id IS DISTINCT FROM OLD.parent_id
        OR NEW.ancestry_path IS DISTINCT FROM OLD.ancestry_path
        OR NEW.depth IS DISTINCT FROM OLD.depth
        OR NEW.ancestry_ltree::text IS DISTINCT FROM OLD.ancestry_ltree::text
      ) AND NOT pg_catalog.pg_has_role(current_user, %2$L, 'USAGE')
        AND NOT (SELECT %1$I.stratum_legacy_bypass()) THEN
        RAISE EXCEPTION 'tenant %% tree columns (parent_id, ancestry_path, depth, ancestry_ltree) change only through the Stratum control role', OLD.id
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      RETURN NEW;
    END;
    $body$
  $fn$, v_schema, v_role);

  EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %I.refuse_tenant_parent_cycle() FROM PUBLIC', v_schema);
  EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %I.refuse_tenant_tree_column_change() FROM PUBLIC', v_schema);

  EXECUTE pg_catalog.format('ALTER FUNCTION %I.stratum_legacy_bypass() OWNER TO %I', v_schema, v_role);
  EXECUTE pg_catalog.format('ALTER FUNCTION %I.stratum_subtree_tenant_ids() OWNER TO %I', v_schema, v_role);
  EXECUTE pg_catalog.format('ALTER FUNCTION %I.refuse_tenant_parent_cycle() OWNER TO %I', v_schema, v_role);
END;
$apply$;

REVOKE ALL ON FUNCTION stratum_apply_control_role(text, text) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Apply the control role now, when the migration may; otherwise warn.
--
-- Applying it grants the control role to the migrating login. That login
-- must be the library's admin login, never the application's, so the grant
-- needs an explicit opt-in: the setting stratum.apply_control_role = 'on',
-- which migrate({ applyControlRole: true }) sets, and Stratum's autoMigrate
-- sets when it runs on adminPool. Without it, the control role is applied
-- only when that grants nothing new: the migrating login is a superuser, or
-- already a member of the control role. Otherwise part 2 is skipped with a
-- WARNING that prints the SQL to run, and the install keeps the pre-1.8
-- behavior until then.
-- ---------------------------------------------------------------------------
DO $control$
DECLARE
  v_schema text := pg_catalog.current_schema();
  v_role text := NULLIF(pg_catalog.current_setting('stratum.control_role', true), '');
  v_opt_in boolean := coalesce(pg_catalog.current_setting('stratum.apply_control_role', true) = 'on', false);
  v_existing text[];
  v_message text;
BEGIN
  SELECT pg_catalog.array_agg(DISTINCT r::text) INTO v_existing
    FROM pg_catalog.pg_policies p, pg_catalog.unnest(p.roles) r
   WHERE p.policyname = 'stratum_control_plane';
  IF v_role IS NULL THEN
    v_role := CASE WHEN pg_catalog.cardinality(v_existing) = 1 THEN v_existing[1] ELSE 'stratum_control' END;
  END IF;

  IF NOT v_opt_in
     AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = current_user AND rolsuper)
     AND NOT (EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role)
              AND pg_catalog.pg_has_role(current_user, v_role, 'USAGE')) THEN
    RAISE WARNING E'Stratum control-role hardening is NOT active in schema "%": the migration did not run with the control-role opt-in (migrate({ applyControlRole: true }), or Stratum autoMigrate with adminPool), so it does not grant the control role to "%". Run this once as a superuser, naming the admin login of the library:\n%\nor run `stratum db roles --apply`. Until then, this database keeps the pre-1.8 behavior.',
      v_schema, current_user,
      pg_catalog.format('CREATE ROLE %I NOLOGIN;', v_role) || E'\n' ||
      pg_catalog.format('GRANT %I TO <admin login> WITH INHERIT TRUE, SET TRUE;', v_role) || E'\n' ||
      pg_catalog.format('SELECT %I.stratum_apply_control_role(%L, %L);', v_schema, v_role, v_schema);
    RETURN;
  END IF;

  BEGIN
    EXECUTE pg_catalog.format('SELECT %I.stratum_apply_control_role(%L, %L)', v_schema, v_role, v_schema);
  EXCEPTION WHEN insufficient_privilege THEN
    -- Everything the call did is rolled back to here; part 1 stays.
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    RAISE WARNING E'Stratum control-role hardening is NOT active in schema "%": %\nUntil that SQL runs, this database keeps the pre-1.8 behavior.',
      v_schema, v_message;
  END;
END
$control$;
