---
"@stratum-hq/mysql": minor
---

`withTenantScope` (Knex) accepts only plain ASCII column names (letters, digits, `_`, `$`, dotted qualifiers) in `insert()`, `update()`, `increment()` and `decrement()`; use plain Knex with an explicit `tenant_id` condition for other names. See GHSA-mg93-96h7-h9fq.
