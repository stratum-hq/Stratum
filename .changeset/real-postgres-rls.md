---
"@stratum-hq/lib": minor
"@stratum-hq/db-adapters": minor
---

Enforce the `SHARED_RLS` isolation strategy with real Postgres row-level security.

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
