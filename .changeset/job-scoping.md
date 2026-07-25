---
"@stratum-hq/lib": minor
---

feat: add `runScopedJob` for tenant-scoped background jobs

`runScopedJob(pool, tenantId, fn)` runs a background job bound to a single
tenant. It establishes both the AsyncLocalStorage tenant context (so in-job code
sees the tenant via `Stratum.currentTenantId()`) and the Postgres row-level
security context (`SET LOCAL app.current_tenant_id` via the data-plane
`withTenantContext`) for the duration of the job, then tears both down on
completion or error. A job cannot read or write another tenant's rows, and the
context does not leak onto the next job that reuses a pooled connection.
