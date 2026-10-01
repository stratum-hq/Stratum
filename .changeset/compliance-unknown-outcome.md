---
"@stratum-hq/compliance": patch
---

`reconcileFinding` throws a `TypeError` that names the value for an unknown control outcome, instead of returning `undefined`. (#477)
