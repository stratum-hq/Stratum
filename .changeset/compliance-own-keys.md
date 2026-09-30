---
"@stratum-hq/compliance": patch
---

`scoreCoverage` now scores a baseline key as `missing` when `resolved` has no own entry for it. Before, a key that names an `Object.prototype` member, such as `constructor` or `toString`, read the inherited member and was scored as `drift`.
