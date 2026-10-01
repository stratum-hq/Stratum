import type { StackPreset } from "../matrix.js";

/** Name of the non-superuser role a generated app connects as. */
export function postgresAppRole(dbName: string): string {
  return `${dbName}_app`;
}

/** Local development password for the generated application role. */
export const POSTGRES_APP_PASSWORD = "dev_app_password";

/**
 * Name of the login Stratum itself connects as: the library's adminPool,
 * which runs the Stratum migrations. It is a member of the control role of
 * @stratum-hq/lib migration 032, not a superuser.
 */
export function postgresStratumRole(dbName: string): string {
  return `${dbName}_stratum`;
}

/** Local development password for the generated Stratum login. */
export const POSTGRES_STRATUM_PASSWORD = "dev_stratum_password";

/**
 * SQL that creates the roles of the hardened role model of @stratum-hq/lib
 * (the "Hardening: separate admin and app roles" guide), as docker/init-db.sql
 * does. POSTGRES_USER is a superuser, and a superuser (or any BYPASSRLS
 * role) ignores every row-level security policy, FORCE included. So the app
 * gets its own role, Stratum gets its own login for its tables, and the
 * superuser is kept for bootstrap and the application's own migrations.
 */
export function postgresAppRoleSql(dbName: string, strategy?: string): string {
  const role = postgresAppRole(dbName);
  const stratum = postgresStratumRole(dbName);
  let strategyGrant = "";
  if (strategy === "schema") {
    strategyGrant = `
-- schema-per-tenant: the app creates one schema per tenant
GRANT CREATE ON DATABASE ${dbName} TO ${role};
`;
  } else if (strategy === "database") {
    strategyGrant = `
-- database-per-tenant: the app creates one database per tenant
ALTER ROLE ${role} CREATEDB;
`;
  }
  return `
-- Stratum's control role (migration 032 of @stratum-hq/lib). Every Stratum
-- table gets a policy for it, and only its members reach rows across
-- tenants.
CREATE ROLE stratum_control NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE, CREATE ON SCHEMA public TO stratum_control;

-- Stratum's own login: pass it to the library as adminPool, which runs the
-- Stratum migrations, so it owns the Stratum tables. Not a superuser and no
-- BYPASSRLS: it reaches them as a member of stratum_control. Do not run the
-- Stratum migrations as the bootstrap superuser: the default privileges
-- below would give the app role write access to the Stratum tables. If that
-- happened, "stratum db roles --apply --app-role ${role}" removes it.
CREATE ROLE ${stratum} WITH LOGIN PASSWORD '${POSTGRES_STRATUM_PASSWORD}' NOSUPERUSER NOBYPASSRLS;
GRANT stratum_control TO ${stratum} WITH INHERIT TRUE, SET TRUE;
GRANT CONNECT ON DATABASE ${dbName} TO ${stratum};
GRANT USAGE, CREATE ON SCHEMA public TO ${stratum};

-- Application role. The app connects as ${role} (DATABASE_URL), never as the
-- bootstrap superuser (DATABASE_ADMIN_URL): a superuser or BYPASSRLS role
-- ignores every row-level security policy, FORCE included. It creates no
-- objects in public: the superuser creates the application's tables (its
-- migrations), and the app role reads and writes the ones the superuser
-- creates. It gets nothing on the tables ${stratum} creates; to let it read
-- Stratum's read list once Stratum has migrated, run:
--   stratum db roles --apply --admin-role ${stratum} --app-role ${role}
CREATE ROLE ${role} WITH LOGIN PASSWORD '${POSTGRES_APP_PASSWORD}' NOSUPERUSER NOBYPASSRLS NOCREATEROLE;
GRANT CONNECT ON DATABASE ${dbName} TO ${role};
GRANT USAGE ON SCHEMA public TO ${role};
ALTER DEFAULT PRIVILEGES FOR ROLE ${dbName} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role};
ALTER DEFAULT PRIVILEGES FOR ROLE ${dbName} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${role};

-- Only roles granted CREATE by name create objects in public. PostgreSQL 15
-- and later already start this way; older versions grant it to PUBLIC.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
${strategyGrant}`;
}

export function generatePresetInitSql(projectName: string, preset: StackPreset): string | null {
  const dbName = projectName.replace(/[^a-z0-9]/gi, "_").toLowerCase();

  switch (preset.database) {
    case "postgres":
      return generatePostgresInit(projectName, dbName, preset.strategy);
    case "mongodb":
      // MongoDB does not use SQL initialization
      return null;
    case "mysql":
      return generateMysqlInit(projectName, dbName);
  }
}

function generatePostgresInit(projectName: string, dbName: string, strategy: string): string {
  let rlsBlock = "";
  if (strategy === "rls") {
    rlsBlock = `
-- Enable Row-Level Security for tenant isolation
-- Add RLS policies to each tenant-scoped table:
--
--   ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE your_table FORCE ROW LEVEL SECURITY;
--   CREATE POLICY tenant_isolation ON your_table
--     USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
--
-- A pooled connection reads the setting as '' after a tenant transaction ends,
-- or as NULL before the first one. NULLIF makes both return no rows; a bare
-- ::uuid cast of '' raises an error.
-- FORCE makes the policy apply to the table owner too; without it, a table
-- created by the application role is not isolated for that role.
-- The Stratum db-adapters package sets app.current_tenant_id automatically.
`;
  }

  return `-- Initialize ${projectName} database
-- Enable required extensions for Stratum multi-tenancy
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "ltree";

-- The ltree extension enables hierarchical tenant trees
-- uuid-ossp provides uuid_generate_v4() for tenant IDs
COMMENT ON DATABASE ${dbName} IS 'Multi-tenant database for ${projectName}';
${postgresAppRoleSql(dbName, strategy)}${rlsBlock}`;
}

function generateMysqlInit(projectName: string, dbName: string): string {
  return `-- Initialize ${projectName} database
-- MySQL setup for Stratum multi-tenancy

-- Ensure utf8mb4 for the database
ALTER DATABASE ${dbName} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Tenant metadata table
CREATE TABLE IF NOT EXISTS _stratum_tenants (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;
}
