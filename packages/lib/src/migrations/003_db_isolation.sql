-- Migration 003: DB_PER_TENANT isolation support
-- Expands the isolation_strategy constraint and adds connection_config column.

-- Allow DB_PER_TENANT in addition to existing strategies.
-- Drop the old constraint first (name from 001_init.sql), then re-add with all three values.
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_isolation_strategy_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_isolation_strategy_check
  CHECK (isolation_strategy IN ('SHARED_RLS', 'SCHEMA_PER_TENANT', 'DB_PER_TENANT'));

-- Optional JSONB column to store per-tenant database connection overrides
-- (e.g. custom host/port for fully isolated DB_PER_TENANT deployments).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS connection_config JSONB DEFAULT NULL;
