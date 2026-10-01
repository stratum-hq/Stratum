---
"@stratum-hq/db-adapters": patch
---

`DatabasePoolManager` now sets each tenant's database name in a `connectionString` given in `baseConnectionConfig`, and refuses a `connectionString` it cannot set the name in (GHSA-r5mc-55fv-2cvp).
