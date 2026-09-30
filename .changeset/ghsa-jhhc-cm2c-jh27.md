---
"@stratum-hq/db-adapters": minor
"@stratum-hq/lib": patch
"@stratum-hq/control-plane": patch
"@stratum-hq/create": patch
---

Harden tenant isolation in the schema-per-tenant and database-per-tenant strategies and the Prisma and Drizzle adapters (GHSA-jhhc-cm2c-jh27). Behavior change: the schema-per-tenant `search_path` is now the tenant schema alone, without `public`; queries that call extension functions or types from another schema must schema-qualify them or opt that schema in with the new `extraSearchPath` option.
