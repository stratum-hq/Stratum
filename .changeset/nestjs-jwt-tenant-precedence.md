---
"@stratum-hq/nestjs": patch
---

Make the verified JWT tenant authoritative in `StratumGuard`. Tenant resolution now runs JWT (verified) before the `X-Tenant-ID` header, so the header is only consulted as a fallback when no verified JWT tenant is present and can never override a verified identity. This aligns the guard's resolution order with the Express and Fastify middleware.
