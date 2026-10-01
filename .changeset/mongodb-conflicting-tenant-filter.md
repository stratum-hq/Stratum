---
"@stratum-hq/mongodb": patch
---

The shared-collection proxy of `MongoSharedAdapter` now throws when a filter names a tenant other than the current one, instead of quietly returning the current tenant's documents for `find({ tenant_id: other })` and nothing for `find({ $and: [{ tenant_id: other }] })`. Any condition on `tenant_id` other than the current tenant's ID (as a value or `{ $eq: id }`) is refused, at the top level or inside `$and`, `$or` or `$nor`, for every filter method, `bulkWrite` filters and a find cursor's `filter()`. (#477)
