---
"@stratum-hq/mysql": minor
---

`withTenantScope` (Knex) treats any key that resolves to `tenant_id` as the tenant column: any letter case, and table- or schema-qualified forms such as `notes.tenant_id` or `db.notes.TENANT_ID`. `update()` drops such keys from the data, `update(column, value)`, `increment()` and `decrement()` refuse them, and `insert()` drops them before it adds the current tenant's `tenant_id`. Previously a qualified key was passed through to MySQL. See GHSA-mg93-96h7-h9fq.
