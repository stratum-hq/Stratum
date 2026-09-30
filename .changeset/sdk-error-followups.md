---
"@stratum-hq/sdk": minor
"@stratum-hq/nestjs": minor
"@stratum-hq/hono": minor
---

`StratumClient` maps a 404 by its error code. `TENANT_NOT_FOUND` becomes `TenantNotFoundError`, `WEBHOOK_NOT_FOUND` becomes `WebhookNotFoundError`, and any other 404 becomes a plain `Error` with the control plane's message. Before this change, every 404 became `TenantNotFoundError`, also on the webhook, API key and region routes.

The Express and Fastify middleware answer a control plane timeout with 504 `CONTROL_PLANE_TIMEOUT`. They answer an `UnauthorizedError` for the SDK's own API key with 500 `CONTROL_PLANE_AUTH_FAILED` and write the cause to `console.error`. They call `onError` for both. Before this change, both errors went to the framework's error handler: a timeout became a 500, and the default Express and Fastify error handlers answered a rejected SDK key with a 401, as if the caller had sent a bad credential.

The SDK exports `tenantErrorResponse` and `controlPlaneErrorResponse`, so other adapters can use the same mapping.

The NestJS `StratumGuard` throws `NotFoundException` (404) for a tenant that does not exist, instead of `UnauthorizedException` (401). This matches the Express and Fastify middleware. It throws `GatewayTimeoutException` (504) for a control plane timeout and `InternalServerErrorException` (500) for a rejected SDK API key. A request with no tenant ID still gets 401.

The Hono `stratumMiddleware` answers a tenant error from its `resolve` callback with 404, 403 or 410, as the Express and Fastify middleware do. It answers a control plane timeout with 504 `CONTROL_PLANE_TIMEOUT`, and an `UnauthorizedError` for the SDK's own API key with 500 `CONTROL_PLANE_AUTH_FAILED` and a `console.error` line. Before this change, all of these errors went to the Hono error handler.

The `timeoutMs` option must be an integer from 1 to 4294967295, or `Infinity` to turn the time limit off. The constructor throws a `RangeError` for any other value. Before this change, an invalid value made every request throw.

`purgeTenant` removes the tenant from the client cache also when the request fails. A timeout does not mean that the purge failed: the control plane can complete it after the client stops waiting.
