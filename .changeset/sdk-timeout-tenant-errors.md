---
"@stratum-hq/sdk": minor
"@stratum-hq/nestjs": patch
---

`StratumClient` has a new `timeoutMs` option (default 10000). A control plane request that takes longer rejects with a `TimeoutError` `DOMException`. Before this change, a request had no time limit.

`StratumClient` now maps a 403 `TENANT_SUSPENDED` response to `TenantSuspendedError`, any other 403 to `ForbiddenError`, and a 410 `TENANT_ARCHIVED` response to `TenantArchivedError`. Before this change, these became a plain `Error`. A `TenantNotFoundError` now keeps the control plane's message, without a second "Tenant not found:" prefix.

The Express and Fastify middleware answer a suspended tenant with 403 `TENANT_SUSPENDED`, an archived tenant with 410 `TENANT_ARCHIVED`, and a denied tenant with 403 `FORBIDDEN`, instead of a 500. The Nest `StratumGuard` throws `ForbiddenException` or `GoneException`. These rules also apply to an impersonation target. In the Express and Fastify middleware, an impersonation target that does not exist now gets a 404 instead of a 500.

`StratumClient` sends `Content-Type: application/json` only with a request body. Before this change, the control plane answered `archiveTenant`, `deleteTenant`, `deleteWebhook` and `deleteRegion` with 400, because it rejects that content type on an empty body.
