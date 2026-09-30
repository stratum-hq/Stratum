---
"@stratum-hq/create": patch
---

Generated projects now depend on the current `@stratum-hq/*` releases. The CLI took the dependency ranges from a hardcoded `^0.2.0`, which installs releases from before 1.0. The build now reads the ranges from the workspace package versions.
