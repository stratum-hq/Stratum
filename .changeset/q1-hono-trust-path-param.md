---
"@stratum-hq/hono": minor
---

`stratumMiddleware` now reads the tenant from a URL path parameter only when `trustPathParam: true` is set, and throws at construction otherwise (GHSA-v3rm-2g9r-cgfg).
