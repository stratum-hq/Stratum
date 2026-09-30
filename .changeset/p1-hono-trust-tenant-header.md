---
"@stratum-hq/hono": minor
---

**Breaking default:** `stratumMiddleware` no longer reads the tenant from a request header unless `trustTenantHeader: true` is set; without it (and without `jwtClaim` or `pathParam`) it throws at construction. Add `trustTenantHeader: true` only if a gateway you control sets the header (GHSA-p3jw-vw8m-3rqr).
