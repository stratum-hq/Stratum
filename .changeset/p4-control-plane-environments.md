---
"@stratum-hq/control-plane": minor
---

Control-plane migrations enforce RLS, and the missing `JWT_AUDIENCE` warning fires, in every environment other than `development` and `test` (an unset `NODE_ENV` counts as `development`) (GHSA-jx2p-pffr-c5gh).
