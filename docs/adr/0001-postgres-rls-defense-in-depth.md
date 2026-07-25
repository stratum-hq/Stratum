# ADR 0001: Postgres Row-Level Security as tenant-isolation defense in depth

Status: Accepted
Date: 2026-07-24
Issue: stratum-hq/Stratum#119

## Context

Every tenant Stratum provisions is stamped with `isolation_strategy = 'SHARED_RLS'`
(see `packages/lib/src/migrations/001_init.sql`). Until now that literal was a
promise the database did not keep: no table had row-level security enabled and no
policy existed (`SELECT * FROM pg_policies` returned zero rows on a migrated
database). Tenant isolation on the shared schema rested entirely on the
application adding `WHERE tenant_id = $1` to every query. A single missing filter,
in Stratum or in a downstream application that stores tenant-scoped rows in the
shared tables, silently exposed every tenant's data.

This ADR records the decision to back the `SHARED_RLS` claim with real Postgres
row-level security (RLS) so the isolation boundary is enforced by the database as
a second, independent layer.

## Decision

Enable RLS with `FORCE` on the tenant-scoped shared-schema tables and attach a
policy that scopes every row to a per-connection tenant context. The application
authorization layer (the control-plane tenant-scope middleware) stays the PRIMARY
enforcement. RLS is a SECOND layer that holds even when the application forgets a
`WHERE tenant_id` filter.

### Two planes

The system has two distinct database-access planes, and RLS is applied to exactly
one of them:

1. Control plane (`packages/lib`, the `Stratum` class and its services). This is
   the trusted code that manages the whole tenant tree: it authenticates API keys
   before any tenant is known, walks ancestry to resolve inherited config, lists
   descendants, moves subtrees, and runs cascade operations. By construction it
   reads and writes across tenant boundaries. It is the "system / admin" path the
   issue calls out as legitimately needing to cross the boundary.

2. Data plane (`packages/db-adapters`, the `RawAdapter` / `BaseAdapter` and the
   Prisma / Drizzle / Sequelize adapters). This is what a downstream application
   uses to store and query ITS OWN tenant-scoped rows in the shared tables. Every
   query here carries a single tenant context. This is where a missing filter is a
   real risk, and this is where RLS enforces isolation.

RLS enforces the data plane. The control plane runs under an explicit, audited
bypass (see "Bypass mechanism").

### Per-connection tenant context

Tenant context is a Postgres GUC set with `SET LOCAL` semantics via
`set_config('app.current_tenant_id', $1, true)` (third argument `true` = local =
transaction scoped). It is issued inside a transaction and is never a session
`SET`. With connection pooling a session GUC would leak the previous request's
tenant into the next request that reuses the pooled connection; `SET LOCAL` resets
automatically at `COMMIT` / `ROLLBACK`. The pool-boundary test proves this.

Helpers (`packages/db-adapters/src/rls/session.ts`):

- `withTenantContext(pool, tenantId, fn)` runs `fn` inside a transaction with
  `app.current_tenant_id` set to `tenantId`.
- `withRlsBypass(pool, fn)` runs `fn` inside a transaction with
  `app.bypass_rls = 'on'` set `SET LOCAL`. This is the audited system path.

### GUC namespace: `app.current_tenant_id`, not `stratum.tenant_id`

The issue used `stratum.tenant_id` illustratively ("e.g."). We use
`app.current_tenant_id` because that is the namespace the entire existing codebase
already uses: `base-adapter.ts`, every adapter (`prisma`, `drizzle`, `sequelize`),
`packages/test-utils/src/assertions.ts`, and the demo API and seed. Introducing a
second namespace would fragment the convention and require touching every one of
those call sites for no security benefit. The bypass flag is `app.bypass_rls` for
the same reason. `stratum.enforce_rls` (used in `001_init.sql` and `migrate.ts` to
gate the BYPASSRLS startup check) is a separate, unrelated setting and is left
untouched.

### Policy shape

Each protected table gets a single `FOR ALL` policy named `tenant_isolation`:

```sql
USING (
  current_setting('app.bypass_rls', true) = 'on'
  OR <scope predicate>
)
WITH CHECK (
  current_setting('app.bypass_rls', true) = 'on'
  OR <scope predicate>
)
```

Properties:

- Fail closed. With no context set, `NULLIF(current_setting('app.current_tenant_id',
  true), '')::uuid` is `NULL`, so `tenant_id = NULL` is `NULL` (not true) and zero
  rows are visible. The two-argument `current_setting(name, true)` returns `NULL`
  rather than raising when the GUC is unset, and `NULLIF(..., '')` also folds the
  empty-string reset value to `NULL`. A query without a tenant context returns
  nothing and a write without one is rejected. It never silently returns
  everything.
- `WITH CHECK` mirrors `USING`, so a write cannot target another tenant: an
  `INSERT` or `UPDATE` that would place a row outside the current tenant is
  rejected.
- `ENABLE ROW LEVEL SECURITY` plus `FORCE ROW LEVEL SECURITY`. `FORCE` makes the
  policy apply even to the table owner. Note that a Postgres `SUPERUSER` and any
  role with `BYPASSRLS` always skip RLS regardless of `FORCE`; that is why the app
  role must be neither (see "Role model").

### Scope: exact tenant, not subtree

The scope predicate for tables carrying `tenant_id` is exact match:
`tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid`.

We deliberately do NOT grant ancestor or descendant (subtree) visibility on the
data plane. Rationale:

- Stratum's ancestry reads (config inheritance in `config-service.ts`, tree
  traversal in `tenant-service.ts`) are CONTROL-PLANE operations. They run in
  `packages/lib` under bypass, so they are unaffected by an exact-match data-plane
  policy.
- Exact match is the strongest, simplest boundary for the data plane: a tenant
  context sees only its own rows, never a sibling's, a parent's, or a child's.
- It matches the convention already established in the codebase: the reference
  policy templates (`rls/policies.sql`, `migration-helpers.ts`) and the
  `assertIsolation` helper in `test-utils` are all exact match.

### Table set

Protected (RLS enabled, `tenant_isolation` policy):

| Table | Scope predicate |
| --- | --- |
| `config_entries` | `tenant_id = ctx` |
| `permission_policies` | `tenant_id = ctx` |
| `audit_logs` | `tenant_id = ctx` |
| `webhook_events` | `tenant_id = ctx` |
| `webhooks` | `tenant_id = ctx` |
| `consent_records` | `tenant_id = ctx` |
| `abac_policies` | `tenant_id = ctx` |
| `api_keys` | `tenant_id = ctx` |
| `roles` | `tenant_id = ctx` |
| `webhook_deliveries` | `EXISTS (webhook_events we WHERE we.id = event_id AND we.tenant_id = ctx)` |
| `principal_roles` | `EXISTS (roles r WHERE r.id = role_id AND r.tenant_id = ctx)` |
| `tenants` | `id = ctx` (self-scope) |

`ctx` is `NULLIF(current_setting('app.current_tenant_id', true), '')::uuid`.

Notes:

- `tenants` is the ancestry source. It has no `tenant_id`; its identity is `id`. We
  self-scope it so a data-plane tenant context can read only its own registry row
  and cannot enumerate the org tree through the shared pool. All tree and ancestry
  operations are control-plane and run under bypass.
- `webhook_deliveries` and `principal_roles` carry no `tenant_id`; they are scoped
  through their tenant-bearing parent (`webhook_events`, `roles`). Under a tenant
  context the parent subquery is itself RLS-filtered, which composes correctly;
  there is no policy recursion because neither parent references back.
- `api_keys`, `roles`, and `principal_roles` are authentication/authorization
  tables that the control plane reads before a tenant context exists (credential
  lookup discovers the tenant). Enabling RLS on them is safe ONLY because the
  control plane runs under bypass. On the data plane they are invisible without a
  matching context, which is the desired hardening. Rows with a `NULL` tenant_id
  (global API keys, global roles) are visible only under bypass, i.e. only to the
  control plane that manages them.

Exempt (RLS not enabled), with rationale:

- `regions`: a global infrastructure catalog (region list, control-plane URLs). It
  has no `tenant_id` and is not tenant-private. It is read by the control plane and
  is not a tenant-data table.
- `_migrations`: internal migration bookkeeping.

### Role model

The role model is already provisioned in `docker/init-db.sql` and used by
`docker-compose.yml`:

- `stratum` (the Postgres superuser / migration + table owner) runs migrations and
  owns the tables. As a superuser it bypasses RLS inherently; this is the migration
  and provisioning path.
- `stratum_app` (`LOGIN`, `NOSUPERUSER`, `NOBYPASSRLS`) is the application
  connection. It is subject to RLS. The control-plane and demo services connect as
  this role.

No new role is required. The critical invariant, restated here and checked at
startup by the `DO` block in `001_init.sql` (hard error when
`stratum.enforce_rls = 'on'`), is that the application role must NOT be a superuser
and must NOT have `BYPASSRLS`. If it does, Postgres skips RLS silently.

### Bypass mechanism

The control plane crosses tenant boundaries legitimately. The issue sanctions
either a dedicated bypass role or "an explicit, audited `withRlsBypass`". We
implement the latter, in band, because it is self-contained, testable on a single
connection, and does not require the app login role to be a member of a
`BYPASSRLS` role (which would reintroduce a soft boundary):

- Policies admit `current_setting('app.bypass_rls', true) = 'on'`.
- `withRlsBypass(pool, fn)` sets `app.bypass_rls = 'on'` with `SET LOCAL` inside a
  transaction, so it is transaction scoped and cannot leak across pooled requests
  (proved by the pool-boundary test).
- The control-plane library (`packages/lib`) routes ALL of its database access
  through `pool-helpers.ts` (`withClient` / `withTransaction`). Those two helpers
  issue `SET LOCAL app.bypass_rls = 'on'`, so the trusted control plane operates
  across the tree while RLS stays enforced on the data plane. This is a single
  chokepoint; no service function changed.

Operators who want a hard, role-enforced bypass instead can run the control-plane
process as a dedicated `BYPASSRLS` role and drop the `app.bypass_rls` predicate;
the data-plane policy is unchanged in that configuration.

## Consequences

### What is now true

- `isolation_strategy = 'SHARED_RLS'` is enforced by Postgres, not just asserted.
- A data-plane query with a tenant context set returns only that tenant's rows
  even with no `WHERE tenant_id` filter. A write cannot target another tenant.
- A data-plane query with no tenant context returns zero rows (fail closed).
- Tenant context is transaction scoped and does not leak across pooled connections.

### Honest limits

RLS here is defense in depth against application LOGIC bugs (a missing filter) and
it limits blast radius. It is NOT a defense against an attacker who can execute
arbitrary SQL as the connected role: such an attacker can set
`app.current_tenant_id` to any victim UUID (or set `app.bypass_rls`) and defeat the
policy. That is inherent to GUC-based tenant context and is true of the
role-enforced variant too (the attacker still controls the context value). The
mitigation is that the context is set by trusted middleware from the authenticated
session, never from request input. The control plane's own queries are not
double-protected by RLS because it runs under bypass; their correctness rests on
the primary application layer, which is unavoidable for code that must read across
tenants.

### Rollout is coordinated, not a drop-in

Enabling this migration changes read/write behavior for every client of the
database, not just this library. Any external process that connects with its own
`pg` client and issues direct SQL against the protected tables becomes subject to
RLS the moment the migration runs: as a non-superuser, non-`BYPASSRLS` role its
direct queries return zero rows unless it sets `app.current_tenant_id` (via
`withTenantContext`) or runs under a documented bypass (`withRlsBypass` or a
`BYPASSRLS` role). Enabling this against a shared database is therefore a
COORDINATED rollout: every direct client must adopt the tenant-context helper (or a
bypass role) first. Do not run this migration against a shared production or demo
database until that coordination is done.

## Alternatives considered

- Correct the claim instead of enforcing it (write a different `isolation_strategy`
  or drop the literal). Rejected by product decision: the point is to make the
  promise true.
- Subtree/ancestor-visible policies on the data plane. Rejected: ancestry reads are
  control-plane concerns and belong under bypass; exact match is the stronger,
  simpler data-plane boundary and matches existing convention.
- A dedicated `BYPASSRLS` role reached via `SET ROLE` for the control plane.
  Viable and documented as an operator option, but the in-band `withRlsBypass` is
  more self-contained and testable and does not require role membership plumbing.
- Scoping each individual control-plane write to `withTenantContext` for extra
  defense in depth. Deferred: it requires threading a client through every service
  and does not change the data-plane guarantee this ADR delivers.
