---
"@stratum-hq/lib": minor
---

reorderTenant takes the tenant tree lock and locks the sibling rows, so concurrent reorders and moves run one after the other (GHSA-54ff-f8q6-8mfx).
