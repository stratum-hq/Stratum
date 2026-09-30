import type { StackPreset } from "../matrix.js";

/** Name of the non-superuser role a generated app connects as. */
export function postgresAppRole(dbName: string): string {
  return `${dbName}_app`;
}

/** Local development password for the generated application role. */
export const POSTGRES_APP_PASSWORD = "dev_app_password";

/**
 * SQL that creates the role the application connects as. POSTGRES_USER is a
 * superuser, and a superuser (or any BYPASSRLS role) ignores every row-level
 * security policy, FORCE included. So the app gets its own role, and the
 * superuser is kept for bootstrap and migrations.
 */
export function postgresAppRoleSql(dbName: string, strategy?: string): string {
  const role = postgresAppRole(dbName);
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
-- Application role. The app connects as ${role} (DATABASE_URL), never as the
-- bootstrap superuser (DATABASE_ADMIN_URL): a superuser or BYPASSRLS role
-- ignores every row-level security policy, FORCE included. Use the superuser
-- only for bootstrap and migrations.
CREATE ROLE ${role} WITH LOGIN PASSWORD '${POSTGRES_APP_PASSWORD}' NOSUPERUSER NOBYPASSRLS NOCREATEROLE;
GRANT CONNECT ON DATABASE ${dbName} TO ${role};
GRANT USAGE, CREATE ON SCHEMA public TO ${role};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${role};
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
