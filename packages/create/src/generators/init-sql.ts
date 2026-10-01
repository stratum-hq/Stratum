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
-- schema-per-tenant: each tenant has its own schema, which npm run
-- tenant:provision creates as the superuser. The app role cannot create
-- schemas. A schema named like a login comes first on that login's default
-- search path ("$user", public), so the Stratum login and the bootstrap
-- superuser search only public.
ALTER ROLE ${stratum} IN DATABASE ${dbName} SET search_path = public;
ALTER ROLE CURRENT_USER IN DATABASE ${dbName} SET search_path = public;
`;
  } else if (strategy === "database") {
    strategyGrant = `
-- database-per-tenant: each tenant has its own database, which npm run
-- tenant:provision creates as the superuser. The app role cannot create
-- databases.
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
-- bootstrap superuser (DATABASE_SUPERUSER_URL): a superuser or BYPASSRLS role
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

const POLICY_USING = "tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid";

/**
 * SQL that turns on row-level security for a table and creates its
 * tenant_isolation policy. A pooled connection reads the setting as '' after
 * a tenant transaction ends, or as NULL before the first one; NULLIF makes
 * both match no rows, where a bare ::uuid cast of '' raises an error.
 */
export function tenantIsolationPolicySql(table: string): string {
  return `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ${table};
CREATE POLICY tenant_isolation ON ${table}
  USING (${POLICY_USING})
  WITH CHECK (${POLICY_USING});
`;
}

/**
 * The schema of the Prisma models of the PostgreSQL rls preset. prisma db push
 * changes only the schemas the datasource lists, so with the models outside
 * public it never drops or alters Stratum's tables there.
 */
export const PRISMA_APP_SCHEMA = "app";

export function generatePresetInitSql(projectName: string, preset: StackPreset): string | null {
  const dbName = projectName.replace(/[^a-z0-9]/gi, "_").toLowerCase();

  switch (preset.database) {
    case "postgres":
      return generatePostgresInit(projectName, dbName, preset);
    case "mongodb":
      // MongoDB does not use SQL initialization
      return null;
    case "mysql":
      return generateMysqlInit(projectName, dbName);
  }
}

function generatePostgresInit(projectName: string, dbName: string, preset: StackPreset): string {
  const strategy = preset.strategy;
  let rlsBlock = "";
  if (strategy === "rls") {
    rlsBlock = `
-- Row-Level Security for tenant isolation. Every tenant-scoped table needs a
-- tenant_id column, ENABLE and FORCE ROW LEVEL SECURITY, and a policy that
-- compares tenant_id with app.current_tenant_id, the setting that the
-- generated tenant helper sets for each tenant query. A table without a
-- policy is not filtered by tenant.
--
-- A pooled connection reads the setting as '' after a tenant transaction ends,
-- or as NULL before the first one. NULLIF makes both return no rows; a bare
-- ::uuid cast of '' raises an error.
-- FORCE makes the policy apply to the table owner too; without it, a table
-- created by the application role is not isolated for that role.
${rlsTables(preset.orm, dbName)}`;
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

/**
 * The tenant-scoped tables of an rls preset and their policies. Prisma and
 * Drizzle create their tables after this file runs, so their policies are in
 * the files those tools read.
 */
function rlsTables(orm: string, dbName: string): string {
  if (orm === "prisma") {
    const role = postgresAppRole(dbName);
    return `--
-- The tables are created by Prisma (prisma/schema.prisma). npm run db:push
-- creates them and then applies their policies from prisma/rls.sql. They are
-- in their own schema, ${PRISMA_APP_SCHEMA}: prisma db push changes only that schema, so it
-- never drops or alters Stratum's tables in public.
CREATE SCHEMA ${PRISMA_APP_SCHEMA};
GRANT USAGE ON SCHEMA ${PRISMA_APP_SCHEMA} TO ${role};
ALTER DEFAULT PRIVILEGES FOR ROLE ${dbName} IN SCHEMA ${PRISMA_APP_SCHEMA} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role};
ALTER DEFAULT PRIVILEGES FOR ROLE ${dbName} IN SCHEMA ${PRISMA_APP_SCHEMA} GRANT USAGE, SELECT ON SEQUENCES TO ${role};
`;
  }
  if (orm === "drizzle") {
    return `--
-- The tables are created by drizzle-kit (src/schema.ts), which also creates
-- the tenant_isolation policy that src/schema.ts declares for each table.
`;
  }
  return `--
-- An example tenant-scoped table and its policy. The superuser running this
-- file owns the table; the app role reads and writes it through the policy.
CREATE TABLE notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notes_tenant_id_idx ON notes (tenant_id);
${tenantIsolationPolicySql("notes")}`;
}

function generateMysqlInit(projectName: string, dbName: string): string {
  return `-- Initialize ${projectName} database
-- MySQL setup for Stratum multi-tenancy

-- Ensure utf8mb4 for the database
ALTER DATABASE ${dbName} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- The tenants: npm run tenant:provision adds each one. slug names the
-- tenant's own database (stratum_tenant_{slug}) or tables ({table}_{slug}),
-- and the app looks it up by the tenant ID of a verified token. Do not change
-- a slug: those names are fixed when the tenant is provisioned.
CREATE TABLE IF NOT EXISTS _stratum_tenants (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(63) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;
}
