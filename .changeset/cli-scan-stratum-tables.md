---
"@stratum-hq/lib": minor
"@stratum-hq/cli": patch
---

`@stratum-hq/lib` exports `STRATUM_TABLES`, the list of tables that Stratum's migrations create. `stratum scan` and `stratum migrate --all` now read this list to skip Stratum's own tables, so they no longer report `abac_policies`, `usage_events`, or `principal_roles` as application tables. `stratum scan --generate` no longer emits `CREATE POLICY` for a table that already has a `tenant_isolation` policy, so the generated script applies without error.
