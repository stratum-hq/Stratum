---
"@stratum-hq/mysql": minor
---

withMysqlTenantScope now scopes Sequelize models to the tenant (GHSA-v3rm-2g9r-cgfg). Previously it only set the @stratum_tenant_id session variable, which nothing filters on. Behavior changes inside the callback, for models with a tenant_id attribute: finds, counts and aggregates return only the tenant's rows and filter included tenant models; bulk update, destroy, restore and increment change only the tenant's rows; creates write the tenant's tenant_id; save, destroy and restore of another tenant's instance throw; upsert, bulkCreate with updateOnDuplicate, truncate and include all are refused; a model query that bypasses these methods throws. The helper now throws when it is not given a Sequelize v6 instance.
