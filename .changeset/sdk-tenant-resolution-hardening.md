---
"@stratum-hq/sdk": minor
"@stratum-hq/control-plane": patch
"@stratum-hq/nestjs": minor
---

Harden tenant resolution in the SDK middleware and align the tenant context response with the documented shape (GHSA-4m57-6j5q-w3fv). `jsonwebtoken` is now declared as an optional peer dependency of `@stratum-hq/sdk`, needed only when `jwtSecret` is used.
