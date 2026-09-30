---
"@stratum-hq/mysql": minor
---

Tighten tenant scoping (GHSA-fxg8-jqvx-hpc5): withTenantScope refuses joins and unions, the TypeORM subscriber refuses upserts on tables whose unique keys lack tenant_id, and MysqlTableAdapter.scopedTable requires baseTables.
