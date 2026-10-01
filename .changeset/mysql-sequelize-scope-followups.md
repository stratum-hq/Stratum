---
"@stratum-hq/mysql": minor
---

Tighten Sequelize scoping in withMysqlTenantScope (GHSA-v3rm-2g9r-cgfg). Behavior changes inside the callback, for models with a tenant_id attribute: includes added by default or named scopes, by an included model's default scope, by `include: { all: true }` and by hooks are now tenant-filtered; a scope's own top-level `Op.and` where clause is kept; `or: true` and `right: true` on an include of a tenant model are refused; `update()`, `destroy()` and `increment()` without a where clause are refused by Sequelize again instead of applying to all of the tenant's rows; `bulkCreate()` adds tenant_id to a `fields` list that leaves it out; save, destroy and restore of an existing instance of a model without a primary key throw; and a query that names a tenant model but bypasses the scoped methods now throws inside model hooks too.
