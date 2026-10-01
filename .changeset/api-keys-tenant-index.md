---
"@stratum-hq/lib": patch
---

New migration 033 adds an index on `api_keys.tenant_id`, so `stratum doctor` no longer warns about a missing `tenant_id` index on a fresh install. The migration is idempotent and also runs in each tenant schema under `migrateAllSchemas`. (#477)
