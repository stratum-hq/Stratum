-- Migration 002: Allow SCHEMA_PER_TENANT in isolation_strategy check constraint
-- Extends the tenants table to support schema-per-tenant isolation (v1.1).

ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_isolation_strategy_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_isolation_strategy_check
  CHECK (isolation_strategy IN ('SHARED_RLS', 'SCHEMA_PER_TENANT'));
