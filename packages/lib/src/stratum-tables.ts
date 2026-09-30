/**
 * The tables that Stratum's own migrations create in the `public` schema, plus
 * the `_migrations` table that the migration runner creates.
 *
 * Tools that inspect a database, such as the CLI's `scan`, use this list to
 * tell Stratum's tables from application tables. Stratum manages the isolation
 * of these tables itself, and some of them have no `tenant_id` column by design.
 * A unit test compares this list with the migration files, so a new migration
 * that creates a table fails the test until the table is added here.
 */
export const STRATUM_TABLES: readonly string[] = Object.freeze([
  "_migrations",
  "abac_policies",
  "api_keys",
  "audit_logs",
  "config_entries",
  "consent_records",
  "permission_policies",
  "principal_roles",
  "regions",
  "roles",
  "tenants",
  "usage_events",
  "webhook_deliveries",
  "webhook_events",
  "webhooks",
]);
