---
"@stratum-hq/lib": minor
"@stratum-hq/core": minor
---

First-class tenant lifecycle: create, suspend, resume, archive, purge

`@stratum-hq/lib` gains `suspendTenant`, `resumeTenant`, and `archiveTenant` (as
tenant-service functions and `Stratum` methods), consolidating the tenant
lifecycle into an explicit state machine: active to suspended/archived, and
either back to active or on to a purge. `deleteTenant` is retained as a
deprecated alias of `archiveTenant`.

Descendant rules are now defined and tested against Postgres: suspend and
archive block when a tenant has active children (leaf-first); resume and create
require an active parent (top-down); purge requires an empty subtree. A
migration widens the `tenants.status` CHECK constraint to allow `suspended`.

`@stratum-hq/core` gains the `suspended` tenant status, the `TenantSuspendedError`
(403) and `InvalidTenantStateError` (409) error classes, and the
`tenant.suspended`, `tenant.resumed`, `tenant.archived`, and `tenant.purged`
webhook event types. Suspended tenants are blocked from `getTenant` and excluded
from subtree listings, matching archived tenants.
