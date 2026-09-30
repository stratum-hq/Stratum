---
"@stratum-hq/control-plane": patch
---

Authenticated requests to a path that matches no route now get 404 instead of 403; unauthenticated requests still get 401, and matched routes stay default-deny (GHSA-p3jw-vw8m-3rqr).
