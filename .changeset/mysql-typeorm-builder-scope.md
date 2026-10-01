---
"@stratum-hq/mysql": minor
---

Enforce TypeORM tenant rules in the query builders (GHSA-v3rm-2g9r-cgfg). Behavior changes on a registered data source: inserts get the current tenant and updates drop tenant_id even with listeners off (`save(…, { listeners: false })`, `.callListeners(false)`); the tenant is written to whichever entity property maps to the tenant_id column; an insert whose primary key belongs to another tenant's row throws "insert refused" with or without listeners; INSERT … SELECT (`valuesFromSelect()`) into a tenant entity is refused, and into other tables a tenant-scoped SELECT keeps its tenant parameter; view entities built from a query builder are created by `synchronize()` without the tenant condition, while reads from a view with a tenant_id column stay scoped.
