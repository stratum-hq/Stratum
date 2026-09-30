---
"@stratum-hq/cli": minor
---

`stratum doctor` now finds tenant parent cycles that are already in the data. Migration 029 refuses a write that makes a cycle, but it does not repair a cycle that an earlier write left behind. The new check lists the tenants of each cycle, states the fix, and makes `doctor` exit with code 1. To repair a cycle, set `parent_id` of one tenant in the cycle to a tenant outside the cycle, or to `NULL`. The CLI docs now also list every `doctor` check.
