---
"@stratum-hq/mysql": minor
---

Tighten tenant scoping (GHSA-fxg8-jqvx-hpc5). Behavior changes: withTenantScope now throws on joins, union()/unionAll() and modify(); the TypeORM subscriber refuses upserts on tables whose unique keys lack tenant_id; MysqlTableAdapter.scopedTable throws without baseTables.
