---
"@stratum-hq/control-plane": minor
---

The control plane's JWT_SECRET presence, length and placeholder checks now apply in every environment other than `development` and `test`, not only `production` (GHSA-p3jw-vw8m-3rqr).
