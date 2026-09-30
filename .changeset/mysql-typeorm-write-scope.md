---
"@stratum-hq/mysql": minor
---

Scope TypeORM updates and deletes to the current tenant (GHSA-fxg8-jqvx-hpc5): registerStratumSubscriber adds the tenant condition to update, delete and soft-delete query builders, and refuses them outside a tenant context.
