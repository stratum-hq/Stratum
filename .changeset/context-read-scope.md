---
"@stratum-hq/control-plane": minor
"@stratum-hq/sdk": minor
---

`GET /api/v1/tenants/:id/context` now requires the `read` scope instead of `admin`. The SDK middleware, the NestJS guard and the Hono resolver call this route, so an app server needs only a `read` key: a tenant-scoped key resolves its own tenant and its descendants, and a global key resolves any tenant. Admin keys keep working. A scope refusal now names the scope the route requires. The SDK documentation states the scope its middleware needs. (GHSA-mg93-96h7-h9fq)
