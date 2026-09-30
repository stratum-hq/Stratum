---
"@stratum-hq/mysql": minor
---

Add `registerStratumSubscriber(dataSource)`. It adds one `StratumTypeOrmSubscriber` to an initialized TypeORM data source, and a second call adds nothing. The subscriber now also rejects a TypeORM upsert whose conflict update writes `tenant_id`, so an upsert cannot give an existing row a different tenant.
