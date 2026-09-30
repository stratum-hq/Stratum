---
"@stratum-hq/mysql": minor
---

Scope TypeORM reads to the current tenant (GHSA-v3rm-2g9r-cgfg). Behavior changes: on a data source registered with registerStratumSubscriber, reads of entities with a tenant_id column (repository find, findOne, count, exists and aggregates, query builder getMany, getOne, getRawMany, getRawOne, getCount, getManyAndCount, getExists and stream, relation loading, and the row save() loads) now return only the current tenant's rows, joined tenant entities are filtered in the join condition, and such reads are refused outside a tenant context. save() with the id of another tenant's row no longer loads that row, so it attempts an insert. Registration throws if the TypeORM select query builder cannot be scoped.
