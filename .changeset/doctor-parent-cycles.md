---
"@stratum-hq/cli": minor
---

`stratum doctor` now finds tenant parent cycles that are already in the data. Migration 029 refuses a write that makes a cycle, but it does not repair a cycle that an earlier write left behind. The new check lists the tenants of each cycle and makes `doctor` exit with code 1. It links to the repair steps in the CLI docs. The repair is one SQL transaction: set `parent_id` of one tenant in the cycle to a tenant outside the cycle, or to `NULL`, then recompute `ancestry_path` and `depth` for the tree. `moveTenant` is not a safe repair for a cycle, because it starts from a stored path that the cycle can make wrong. The CLI docs now also list every `doctor` check.
