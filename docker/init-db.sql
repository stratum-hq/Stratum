-- Create extensions as superuser (required for uuid-ossp and ltree)
\c stratum
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "ltree";

-- Create a dedicated application role without BYPASSRLS for RLS enforcement.
-- The default POSTGRES_USER (stratum) is the superuser; the app connects as stratum_app.
CREATE ROLE stratum_app WITH LOGIN PASSWORD 'stratum_dev' NOBYPASSRLS;
GRANT ALL PRIVILEGES ON DATABASE stratum TO stratum_app;
GRANT ALL ON SCHEMA public TO stratum_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO stratum_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO stratum_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO stratum_app;
