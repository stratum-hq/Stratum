---
"@stratum-hq/db-adapters": patch
---

`createPolicy()`, `isRLSEnabled()` and `listTenantSchemas()` harden their catalog lookups (GHSA-mg93-96h7-h9fq).
