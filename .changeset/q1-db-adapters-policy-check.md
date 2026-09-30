---
"@stratum-hq/db-adapters": minor
---

`createPolicy` now checks that an existing `tenant_isolation` policy on the table filters by tenant, and throws instead of keeping one that does not. `isRLSEnabled` now reports on the table the name resolves to, schema included, and rejects invalid table names (GHSA-v3rm-2g9r-cgfg).
