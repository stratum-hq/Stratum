# @stratum-hq/db-adapters

## 0.4.0

### Minor Changes

- 523abeb: Enforce the `SHARED_RLS` isolation strategy with real Postgres row-level security.

  Migration `019_rls_policies.sql` enables `ROW LEVEL SECURITY` (with `FORCE`) and a
  tenant-isolation policy on every tenant-scoped shared-schema table, so tenant
  isolation is enforced by the database as a second layer independent of the
  application's `WHERE tenant_id` filters. Context is set per transaction with
  `SET LOCAL` (`app.current_tenant_id`), and a `withRlsBypass` helper (new, exported
  from `@stratum-hq/db-adapters` alongside `withTenantContext`) provides the audited
  system path for control-plane cross-tenant operations.

  Rollout note: after this migration runs, any client connecting as a non-superuser,
  non-`BYPASSRLS` role must set the tenant context (`withTenantContext`) or use a
  bypass, or its direct queries against the protected tables return zero rows. Do not
  enable this against a shared database until every direct client has adopted the
  tenant-context helper. See `docs/adr/0001-postgres-rls-defense-in-depth.md`.

## 0.3.1

### Patch Changes

- abc555d: Fix encryption key rotation to re-encrypt every sensitive row exactly once. Rotation now walks config entries and webhook secrets with a keyset cursor over the primary key, so datasets larger than a single batch are rotated fully and correctly instead of stalling after the first batch.

  Validate the tenant slug in `setSchemaSearchPath` before it is used to build the schema identifier, matching the other schema-isolation adapters. Identifiers outside the canonical slug charset are now rejected rather than interpolated into the search-path statement.

## 0.3.0

### Minor Changes

- Security hardening release plus ecosystem polish: NestJS ALS context-leak fix, SSRF-safe webhook validation, production JWT/HKDF enforcement, fail-closed ORM adapters, SHA-pinned CI (#84); `create --preset` architecture with ORM-aware generators and Stack Wizard (#85); scaffolded projects now target Next 15 / React 19 / NestJS 11; MIT LICENSE and READMEs shipped in every package; dependency security bumps across the workspace.

### Patch Changes

- Updated dependencies
  - @stratum-hq/core@0.3.0

## 0.2.4

### Patch Changes

- Security hardening: fix NestJS tenant context leak, SSRF bypass in webhook delivery, RLS session scoping, fail-closed DB adapters, JWT secret hardening, tenant endpoint scoping, Knex INSERT injection, GitHub Actions pinning
