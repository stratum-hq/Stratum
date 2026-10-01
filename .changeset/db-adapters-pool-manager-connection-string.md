---
"@stratum-hq/db-adapters": patch
---

`DatabasePoolManager` now sets each tenant's database name in a `connectionString` given in `baseConnectionConfig`, checks the result by parsing it as pg does, and refuses a `connectionString` it cannot set the name in. The error lists the supported forms (GHSA-r5mc-55fv-2cvp). `pg-connection-string` is now a direct dependency; it was already installed through `pg`.
