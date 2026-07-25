---
"@stratum-hq/lib": minor
---

Add a per-tenant rate-limiting primitive (`RateLimiter`).

`RateLimiter` is a standalone, storage-agnostic fixed-window limiter for library
consumers, distinct from the control plane's HTTP rate limiting. It resolves an
effective per-tenant limit (a `resolveLimit` hook, a static `limits` map, then a
`defaultLimit`), and exposes `checkLimit(tenantId, key?)` returning
`{ allowed, limit, remaining, resetAt, retryAfter }`. Storage is pluggable via
the documented `RateLimitStore` contract; a process-local `MemoryRateLimitStore`
ships as the default, and the `resolveLimit` hook is the seam for driving limits
from Stratum config inheritance. No new runtime dependencies.
