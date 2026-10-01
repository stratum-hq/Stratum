---
"@stratum-hq/db-adapters": minor
---

`createPolicy` now checks every permissive policy on the table, and that an existing `tenant_isolation` policy applies to PUBLIC, and throws instead of adding or keeping a policy when any of them does not filter by tenant. `isRLSEnabled` now reports on the table the name resolves to, schema included, and rejects invalid table names (GHSA-v3rm-2g9r-cgfg).
