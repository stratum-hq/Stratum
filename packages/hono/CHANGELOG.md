# @stratum-hq/hono

## 1.1.0

### Minor Changes

- e7e7b74: `StratumClient` maps a 404 by its error code. `TENANT_NOT_FOUND` becomes `TenantNotFoundError`, `WEBHOOK_NOT_FOUND` becomes `WebhookNotFoundError`, and any other 404 becomes a plain `Error` with the control plane's message. Before this change, every 404 became `TenantNotFoundError`, also on the webhook, API key and region routes.

  The Express and Fastify middleware answer a control plane timeout with 504 `CONTROL_PLANE_TIMEOUT`. They answer an `UnauthorizedError` for the SDK's own API key with 500 `CONTROL_PLANE_AUTH_FAILED` and write the cause to `console.error`. They call `onError` for both. Before this change, both errors went to the framework's error handler: a timeout became a 500, and the default Express and Fastify error handlers answered a rejected SDK key with a 401, as if the caller had sent a bad credential.

  The SDK exports `tenantErrorResponse` and `controlPlaneErrorResponse`, so other adapters can use the same mapping.

  The NestJS `StratumGuard` throws `NotFoundException` (404) for a tenant that does not exist, instead of `UnauthorizedException` (401). This matches the Express and Fastify middleware. It throws `GatewayTimeoutException` (504) for a control plane timeout and `InternalServerErrorException` (500) for a rejected SDK API key. A request with no tenant ID still gets 401.

  The Hono `stratumMiddleware` answers a tenant error from its `resolve` callback with 404, 403 or 410, as the Express and Fastify middleware do. It answers a control plane timeout with 504 `CONTROL_PLANE_TIMEOUT`, and an `UnauthorizedError` for the SDK's own API key with 500 `CONTROL_PLANE_AUTH_FAILED` and a `console.error` line. Before this change, all of these errors went to the Hono error handler.

  The `timeoutMs` option must be an integer from 1 to 4294967295, or `Infinity` to turn the time limit off. The constructor throws a `RangeError` for any other value. Before this change, an invalid value made every request throw.

  `purgeTenant` removes the tenant from the client cache also when the request fails. A timeout does not mean that the purge failed: the control plane can complete it after the client stops waiting.

### Patch Changes

- b47f84f: Declare sibling `@stratum-hq/*` dependencies with caret ranges instead of `"*"` or `>=`. An install now gets a sibling version that has the API the package calls, and never a future major version.

## 1.0.0

### Minor Changes

- c17b1a5: Rename the `TenantContextLegacy` type to `ResolvedTenantContext` (#219, from the #133 v1.0 surface review).

  The 1.0 public surface should carry no "Legacy" name. The flat, resolved per-request tenant context (fields `tenant_id`, `ancestry_path`, `depth`, `resolved_config`, `resolved_permissions`, `isolation_strategy`) is now `ResolvedTenantContext`, which sits with the existing `Resolved*` family and is clearly distinct from the richer object-graph `TenantContext`. The type is renamed at its definition in `@stratum-hq/core`, in the `@stratum-hq/sdk` re-export, and in every internal use. No deprecated alias is kept.

  If you import `TenantContextLegacy` from `@stratum-hq/core` or `@stratum-hq/sdk`, or annotate values from `Stratum.currentTenantContext()` / `Stratum.runWithTenant()` or the SDK/Hono middleware with it, switch to `ResolvedTenantContext`. The shape is unchanged.

### Patch Changes

- b55ae70: Correct and complete package metadata for the npm registry listing.

  Every published package now declares `license` (MIT), `author`, `homepage`, and
  `bugs`. Runtime packages declare `engines` (Node >=20) to match the project's
  support policy; this fixes `@stratum-hq/cli`, which previously declared Node >=18.
  `@stratum-hq/mysql` and `@stratum-hq/mongodb` gain the `keywords` array they were
  missing. No runtime code changes.

- Updated dependencies [b55ae70]
- Updated dependencies [c17b1a5]
- Updated dependencies [c17b1a5]
- Updated dependencies [5e87692]
- Updated dependencies [4adcbb5]
- Updated dependencies [c17b1a5]
- Updated dependencies [c17b1a5]
  - @stratum-hq/core@1.0.0
  - @stratum-hq/sdk@1.0.0

## 0.2.0

### Minor Changes

- Security hardening release plus ecosystem polish: NestJS ALS context-leak fix, SSRF-safe webhook validation, production JWT/HKDF enforcement, fail-closed ORM adapters, SHA-pinned CI (#84); `create --preset` architecture with ORM-aware generators and Stack Wizard (#85); scaffolded projects now target Next 15 / React 19 / NestJS 11; MIT LICENSE and READMEs shipped in every package; dependency security bumps across the workspace.

### Patch Changes

- Updated dependencies
  - @stratum-hq/core@0.3.0
  - @stratum-hq/sdk@0.3.0
