---
"@stratum-hq/cli": minor
---

`stratum doctor` reports tree depth as an advisory. Stratum accepts a tenant tree of any depth, so the check no longer fails above depth 20 and no longer calls 20 a limit. It reports the maximum depth, and warns when that depth is more than a threshold. The default threshold is 20. To change it, use `--depth-warning <n>` or the `STRATUM_DOCTOR_DEPTH_WARNING` environment variable. A deep tree alone no longer makes `doctor` exit with code 1.
