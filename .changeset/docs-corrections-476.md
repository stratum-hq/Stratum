---
"@stratum-hq/lib": patch
"@stratum-hq/control-plane": patch
"@stratum-hq/db-adapters": patch
"@stratum-hq/hono": patch
"@stratum-hq/mysql": patch
"@stratum-hq/compliance": patch
---

README corrections (#476). lib: the usage metering link works on npm. control-plane: how to start it from an npm install, the health check at `/api/v1/health`, the OpenAPI URLs, and how to create the first admin key. db-adapters: the Sequelize wrapper scopes `query()` only. hono: the quick start defines `sdkClient`. mysql: the TypeORM subscriber reads the tenant from the `@stratum-hq/sdk` context, set with `runWithTenantContext` outside the SDK middleware. compliance: links to its new documentation page.
