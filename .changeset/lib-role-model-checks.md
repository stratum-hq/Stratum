---
"@stratum-hq/lib": minor
---

Hardened role-model checks (GHSA-mg93-96h7-h9fq): the catalog queries of the checks and migration 032 are hardened, with new `pinnedQuery()`, `withPinnedSearchPath()` and `schemaOfTable()`; the control-role opt-in counts only when the migrating session sets it; migration 032 checks the Stratum tables before it applies the control role and warns instead when they carry foreign objects; applying the control role takes over every Stratum function; `initialize()` reports an application login that can create objects in the Stratum schema, and fails on it with `adminPool` and `enforceRls`; `autoMigrate` refuses an `adminPool` that logs in as the same role as `pool`.
