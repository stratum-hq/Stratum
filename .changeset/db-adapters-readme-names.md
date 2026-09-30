---
"@stratum-hq/db-adapters": patch
---

Republish so the README on npm matches the 1.0 API. The 1.0.0 README showed the pre-1.0 names `withTenant`, `withDrizzleTenant` and `withTenantScope`; the package exports `prismaWithTenant`, `drizzleWithTenant` and `sequelizeWithTenantScope`.
