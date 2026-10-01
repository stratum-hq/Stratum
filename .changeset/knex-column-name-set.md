---
"@stratum-hq/mysql": patch
---

`withTenantScope` (Knex) now refuses, in `insert()`, `update()`, `increment()` and `decrement()`, a column name that is not made of ASCII letters, digits, underscores and `$` (with dots between qualified parts). Knex trims each part of a column name and MySQL folds some non-ASCII letters when it matches a column, so a name such as `"tenant_id "` could previously reach `tenant_id` in an update. A scoped builder that writes a column whose name has spaces, other punctuation or non-ASCII letters now throws; use plain Knex with an explicit `tenant_id` condition for such a column. See GHSA-mg93-96h7-h9fq.
