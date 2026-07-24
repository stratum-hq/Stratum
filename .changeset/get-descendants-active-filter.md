---
"@stratum-hq/lib": minor
---

`getDescendants` now returns only active descendants by default, matching `getChildren`, `listTenants`, and the default of `getTenant`. Archived and soft-deleted tenants are excluded from a subtree listing. Callers that need the full historical subtree (for example lifecycle or data-retention passes) pass the new `includeArchived` argument: `getDescendants(id, true)`. The subtree query and its three-state behavior (active / archived / soft-deleted) are now documented on the method and covered by unit and integration tests.
