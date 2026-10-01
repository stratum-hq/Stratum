# @stratum-hq/nestjs

## 1.3.2

### Patch Changes

- e1b2249: `StratumModule` now exports the `STRATUM_OPTIONS` token. Before this change, an application that used `@UseGuards(StratumGuard)` on a controller, as the quick start shows, failed at startup with `UnknownDependenciesException`, because Nest could not give the guard its options in the controller's module. This applies to `forRoot` and `forRootAsync`.

## 1.3.1

### Patch Changes

- b737034: Improve the npm metadata so that npm search finds the packages. Each `description` now starts with the problem the package solves. Each package carries the same multi-tenancy keywords, including `multitenancy`. The `homepage` field now points at the package's page on https://docs.stratum-hq.org instead of a GitHub folder. The first lines of each README link the documentation. No code changes.
- a1bd9aa: Replace em dashes in user-visible text with ordinary punctuation. This touches READMEs, package descriptions, CLI output, control plane startup log messages, the text that `@stratum-hq/create` writes into generated projects, and the assertion messages in `@stratum-hq/test-utils`. The CLI `health` and `migrate` tables now print `no` instead of a dash for an unset flag. No behavior changes.

## 1.3.0

### Minor Changes

- 4c1686a: Add optional `jwtAudience` and `jwtIssuer` options to the SDK middleware and the NestJS guard; when set, tokens whose `aud` or `iss` claim does not match are rejected (GHSA-p3jw-vw8m-3rqr).

## 1.2.0

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
- ac561f9: `StratumClient` has a new `timeoutMs` option (default 10000). A control plane request that takes longer rejects with a `TimeoutError` `DOMException`. Before this change, a request had no time limit.

  `StratumClient` now maps a 403 `TENANT_SUSPENDED` response to `TenantSuspendedError`, any other 403 to `ForbiddenError`, and a 410 `TENANT_ARCHIVED` response to `TenantArchivedError`. Before this change, these became a plain `Error`. A `TenantNotFoundError` now keeps the control plane's message, without a second "Tenant not found:" prefix.

  The Express and Fastify middleware answer a suspended tenant with 403 `TENANT_SUSPENDED`, an archived tenant with 410 `TENANT_ARCHIVED`, and a denied tenant with 403 `FORBIDDEN`, instead of a 500. The Nest `StratumGuard` throws `ForbiddenException` or `GoneException`. These rules also apply to an impersonation target. In the Express and Fastify middleware, an impersonation target that does not exist now gets a 404 instead of a 500. The middleware answers these tenant errors itself, so they no longer reach `onError` or the framework's error handler.

  An API key without the `admin` scope now gets `ForbiddenError` from `purgeTenant` and the other admin operations. An API key that is scoped to a tenant gets 403 `FORBIDDEN` for a descendant that is suspended or archived, not `TENANT_SUSPENDED` or `TENANT_ARCHIVED`, because the scope check runs first.

  `StratumClient` sends `Content-Type: application/json` only with a request body. Before this change, the control plane answered `archiveTenant`, `deleteTenant`, `deleteWebhook` and `deleteRegion` with 400, because it rejects that content type on an empty body.

## 1.1.0

### Minor Changes

- dca0826: Harden tenant resolution in the SDK middleware and align the tenant context response with the documented shape (GHSA-4m57-6j5q-w3fv). `jsonwebtoken` is now declared as an optional peer dependency of `@stratum-hq/sdk`, needed only when `jwtSecret` is used.

### Patch Changes

- 9de2ddb: `StratumInterceptor.intercept()` is now typed as returning `Observable<unknown>` instead of `Observable<any>`. Runtime behavior is unchanged.

## 1.0.0

### Patch Changes

- b55ae70: Correct and complete package metadata for the npm registry listing.

  Every published package now declares `license` (MIT), `author`, `homepage`, and
  `bugs`. Runtime packages declare `engines` (Node >=20) to match the project's
  support policy; this fixes `@stratum-hq/cli`, which previously declared Node >=18.
  `@stratum-hq/mysql` and `@stratum-hq/mongodb` gain the `keywords` array they were
  missing. No runtime code changes.

- 4adcbb5: Stop shipping test files in published tarballs. tsc-built packages now exclude **tests** directories and .test/.spec files from compilation, so dist and the tarball contain only real package output. The create package, which ships source for its ./matrix export, excludes tests via .npmignore instead. The vitest runner is unaffected and still runs tests from src.
- Updated dependencies [b55ae70]
- Updated dependencies [c17b1a5]
- Updated dependencies [c17b1a5]
- Updated dependencies [5e87692]
- Updated dependencies [4adcbb5]
- Updated dependencies [c17b1a5]
- Updated dependencies [c17b1a5]
  - @stratum-hq/core@1.0.0
  - @stratum-hq/sdk@1.0.0

## 0.3.1

### Patch Changes

- 1a0b9b5: Make the verified JWT tenant authoritative in `StratumGuard`. Tenant resolution now runs JWT (verified) before the `X-Tenant-ID` header, so the header is only consulted as a fallback when no verified JWT tenant is present and can never override a verified identity. This aligns the guard's resolution order with the Express and Fastify middleware.

## 0.3.0

### Minor Changes

- Security hardening release plus ecosystem polish: NestJS ALS context-leak fix, SSRF-safe webhook validation, production JWT/HKDF enforcement, fail-closed ORM adapters, SHA-pinned CI (#84); `create --preset` architecture with ORM-aware generators and Stack Wizard (#85); scaffolded projects now target Next 15 / React 19 / NestJS 11; MIT LICENSE and READMEs shipped in every package; dependency security bumps across the workspace.

### Patch Changes

- Updated dependencies
  - @stratum-hq/core@0.3.0
  - @stratum-hq/sdk@0.3.0

## 0.2.4

### Patch Changes

- Security hardening: fix NestJS tenant context leak, SSRF bypass in webhook delivery, RLS session scoping, fail-closed DB adapters, JWT secret hardening, tenant endpoint scoping, Knex INSERT injection, GitHub Actions pinning
