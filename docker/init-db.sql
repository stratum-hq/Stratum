-- Runs once, as the bootstrap superuser (POSTGRES_USER, stratum), when the
-- database volume is created. See the "Hardening: separate admin and app
-- roles" guide for the role model of @stratum-hq/lib migration 032.
\c stratum

-- Extensions need the superuser (uuid-ossp and ltree).
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "ltree";

-- stratum_control: the NOLOGIN control role. Every Stratum table gets a
-- policy for it, and only its members reach rows across tenants. Created
-- here, by the superuser, so that the migrations can apply it although they
-- run as stratum_admin, which cannot create roles.
CREATE ROLE stratum_control NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE, CREATE ON SCHEMA public TO stratum_control;

-- stratum_admin: the control plane's admin login (DATABASE_ADMIN_URL). Not a
-- superuser and no BYPASSRLS: it reaches the Stratum tables as a member of
-- stratum_control. It runs the migrations, so it owns the Stratum tables, and
-- it creates the schemas and databases of isolated tenants.
CREATE ROLE stratum_admin WITH LOGIN PASSWORD 'stratum_dev' NOSUPERUSER NOBYPASSRLS CREATEDB;
GRANT stratum_control TO stratum_admin WITH INHERIT TRUE, SET TRUE;
GRANT CONNECT, CREATE ON DATABASE stratum TO stratum_admin;
GRANT USAGE, CREATE ON SCHEMA public TO stratum_admin;

-- stratum_app: the application login (DATABASE_URL), without BYPASSRLS. It
-- is not a member of stratum_control, owns nothing of Stratum's, and cannot
-- write the Stratum tables. It cannot create objects in public, where the
-- Stratum tables live: it creates and owns the application's own tables in
-- its own schema, stratum_app, which is first on its default search path
-- ("$user", public), so unqualified CREATE TABLE statements land there and
-- unqualified names still find the Stratum tables in public. To let it read
-- the recommended read list (tenants, config_entries, ...; never api_keys,
-- webhooks or regions), run once the control plane has migrated:
--   stratum db roles --apply --admin-role stratum_admin --app-role stratum_app \
--     --database-url postgres://stratum:stratum_dev@localhost:5432/stratum
-- Default privileges cannot name tables, so they cannot grant that list.
CREATE ROLE stratum_app WITH LOGIN PASSWORD 'stratum_dev' NOSUPERUSER NOBYPASSRLS;
GRANT CONNECT ON DATABASE stratum TO stratum_app;
GRANT USAGE ON SCHEMA public TO stratum_app;
CREATE SCHEMA stratum_app AUTHORIZATION stratum_app;

-- Only roles granted CREATE by name create objects in public. PostgreSQL 15
-- and later already start this way; older versions grant it to PUBLIC.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
