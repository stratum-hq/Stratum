---
"@stratum-hq/mysql": minor
---

withMysqlTenantScope scopes Sequelize models to the tenant (GHSA-v3rm-2g9r-cgfg). In 0.5.0 it only set the @stratum_tenant_id session variable, which nothing filters on. Behavior changes inside the callback, for models with a tenant_id attribute:

- finds, counts and aggregates return only the tenant's rows, and every include of a tenant model is filtered in its join condition, including includes added by default or named scopes, by an included model's default scope, by `include: { all: true }` and by hooks; a scope's own where clause is kept;
- bulk update, destroy, restore, increment and decrement change only the tenant's rows; `update()`, `destroy()` and `increment()` without a where clause are refused by Sequelize, as outside the helper;
- updates never write tenant_id, whether it is given by attribute name or column name, in any letter case, and it is removed from a `fields` list; increment and decrement of tenant_id are refused;
- creates and `bulkCreate()` write the tenant's tenant_id, also when a `fields` list leaves it out;
- save, destroy and restore of an instance whose row belongs to another tenant, or of an existing instance of a model without a primary key, throw;
- upsert, bulkCreate with updateOnDuplicate, truncate, and `or: true` or `right: true` on an include of a tenant model are refused;
- a query that carries a tenant model but bypasses these methods throws, including inside model hooks, and a query whose tenant condition a hook removed (by replacing the where clause or adding includes late) is refused.

The helper throws when it is not given a Sequelize v6 instance.
