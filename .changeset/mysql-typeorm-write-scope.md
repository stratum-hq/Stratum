---
"@stratum-hq/mysql": minor
---

Scope TypeORM writes to the current tenant (GHSA-fxg8-jqvx-hpc5). Behavior changes: registerStratumSubscriber adds the tenant condition to update, delete and soft-delete query builders and refuses them outside a tenant context; save() of a row that belongs to another tenant throws; TRUNCATE (clear(), clearTable()) of a tenant table is refused; a subscriber added to dataSource.subscribers by hand now refuses every UPDATE and DELETE.
