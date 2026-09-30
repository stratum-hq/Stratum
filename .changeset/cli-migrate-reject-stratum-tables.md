---
"@stratum-hq/cli": patch
---

`stratum migrate <table>` now rejects the name of a table that Stratum's own migrations create, such as `tenants` or `usage_events`. Before, the command added `tenant_id` and a `tenant_isolation` policy to that table.
