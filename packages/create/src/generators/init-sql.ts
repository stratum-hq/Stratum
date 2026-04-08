import type { StackPreset } from "../matrix.js";

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
--   CREATE POLICY tenant_isolation ON your_table
--     USING (tenant_id = current_setting('app.current_tenant')::uuid);
--
-- The Stratum db-adapters package sets app.current_tenant automatically.
`;
  }

  return `-- Initialize ${projectName} database
-- Enable required extensions for Stratum multi-tenancy
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "ltree";

-- The ltree extension enables hierarchical tenant trees
-- uuid-ossp provides uuid_generate_v4() for tenant IDs
COMMENT ON DATABASE ${dbName} IS 'Multi-tenant database for ${projectName}';
${rlsBlock}`;
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
