# @stratum-hq/sdk

## 1.4.0

### Minor Changes

- 99437c5: `GET /api/v1/tenants/:id/context` now requires the `read` scope instead of `admin`. The SDK middleware, the NestJS guard and the Hono resolver call this route, so an app server needs only a `read` key: a tenant-scoped key resolves its own tenant and its descendants, and a global key resolves any tenant. Admin keys keep working. A scope refusal now names the scope the route requires. The SDK documentation states the scope its middleware needs. (GHSA-mg93-96h7-h9fq)

### Patch Changes

- Updated dependencies [99437c5]
- Updated dependencies [99437c5]
- Updated dependencies [99437c5]
- Updated dependencies [99437c5]
  - @stratum-hq/core@1.6.0

## 1.3.1

### Patch Changes

- b737034: Improve the npm metadata so that npm search finds the packages. Each `description` now starts with the problem the package solves. Each package carries the same multi-tenancy keywords, including `multitenancy`. The `homepage` field now points at the package's page on https://docs.stratum-hq.org instead of a GitHub folder. The first lines of each README link the documentation. No code changes.
- a1bd9aa: Replace em dashes in user-visible text with ordinary punctuation. This touches READMEs, package descriptions, CLI output, control plane startup log messages, the text that `@stratum-hq/create` writes into generated projects, and the assertion messages in `@stratum-hq/test-utils`. The CLI `health` and `migrate` tables now print `no` instead of a dash for an unset flag. No behavior changes.
- Updated dependencies [b737034]
- Updated dependencies [a1bd9aa]
  - @stratum-hq/core@1.5.1

## 1.3.0

### Minor Changes

- 4c1686a: Add optional `jwtAudience` and `jwtIssuer` options to the SDK middleware and the NestJS guard; when set, tokens whose `aud` or `iss` claim does not match are rejected (GHSA-p3jw-vw8m-3rqr).

### Patch Changes

- Updated dependencies [4c1686a]
  - @stratum-hq/core@1.5.0

## 1.2.0

### Minor Changes

- e7e7b74: `StratumClient` maps a 404 by its error code. `TENANT_NOT_FOUND` becomes `TenantNotFoundError`, `WEBHOOK_NOT_FOUND` becomes `WebhookNotFoundError`, and any other 404 becomes a plain `Error` with the control plane's message. Before this change, every 404 became `TenantNotFoundError`, also on the webhook, API key and region routes.

  The Express and Fastify middleware answer a control plane timeout with 504 `CONTROL_PLANE_TIMEOUT`. They answer an `UnauthorizedError` for the SDK's own API key with 500 `CONTROL_PLANE_AUTH_FAILED` and write the cause to `console.error`. They call `onError` for both. Before this change, both errors went to the framework's error handler: a timeout became a 500, and the default Express and Fastify error handlers answered a rejected SDK key with a 401, as if the caller had sent a bad credential.

  The SDK exports `tenantErrorResponse` and `controlPlaneErrorResponse`, so other adapters can use the same mapping.

  The NestJS `StratumGuard` throws `NotFoundException` (404) for a tenant that does not exist, instead of `UnauthorizedException` (401). This matches the Express and Fastify middleware. It throws `GatewayTimeoutException` (504) for a control plane timeout and `InternalServerErrorException` (500) for a rejected SDK API key. A request with no tenant ID still gets 401.

  The Hono `stratumMiddleware` answers a tenant error from its `resolve` callback with 404, 403 or 410, as the Express and Fastify middleware do. It answers a control plane timeout with 504 `CONTROL_PLANE_TIMEOUT`, and an `UnauthorizedError` for the SDK's own API key with 500 `CONTROL_PLANE_AUTH_FAILED` and a `console.error` line. Before this change, all of these errors went to the Hono error handler.

  The `timeoutMs` option must be an integer from 1 to 4294967295, or `Infinity` to turn the time limit off. The constructor throws a `RangeError` for any other value. Before this change, an invalid value made every request throw.

  `purgeTenant` removes the tenant from the client cache also when the request fails. A timeout does not mean that the purge failed: the control plane can complete it after the client stops waiting.

- ac561f9: Add `StratumClient.purgeTenant(id)`, which calls `POST /api/v1/tenants/:id/purge` to permanently delete a tenant and its data. Deprecate `deleteTenant(id)`: it sends the same soft-delete request as `archiveTenant(id)` and does not remove data.
- ac561f9: `StratumClient` has a new `timeoutMs` option (default 10000). A control plane request that takes longer rejects with a `TimeoutError` `DOMException`. Before this change, a request had no time limit.

  `StratumClient` now maps a 403 `TENANT_SUSPENDED` response to `TenantSuspendedError`, any other 403 to `ForbiddenError`, and a 410 `TENANT_ARCHIVED` response to `TenantArchivedError`. Before this change, these became a plain `Error`. A `TenantNotFoundError` now keeps the control plane's message, without a second "Tenant not found:" prefix.

  The Express and Fastify middleware answer a suspended tenant with 403 `TENANT_SUSPENDED`, an archived tenant with 410 `TENANT_ARCHIVED`, and a denied tenant with 403 `FORBIDDEN`, instead of a 500. The Nest `StratumGuard` throws `ForbiddenException` or `GoneException`. These rules also apply to an impersonation target. In the Express and Fastify middleware, an impersonation target that does not exist now gets a 404 instead of a 500. The middleware answers these tenant errors itself, so they no longer reach `onError` or the framework's error handler.

  An API key without the `admin` scope now gets `ForbiddenError` from `purgeTenant` and the other admin operations. An API key that is scoped to a tenant gets 403 `FORBIDDEN` for a descendant that is suspended or archived, not `TENANT_SUSPENDED` or `TENANT_ARCHIVED`, because the scope check runs first.

  `StratumClient` sends `Content-Type: application/json` only with a request body. Before this change, the control plane answered `archiveTenant`, `deleteTenant`, `deleteWebhook` and `deleteRegion` with 400, because it rejects that content type on an empty body.

- 329cb16: `StratumClient` throws typed errors for more control plane responses. A 400 `VALIDATION_ERROR` becomes a `ValidationError` with the failed fields in `details.issues`. Before, it was a plain `Error` without the issues. Other `details` from the control plane stay in `details` too. A 404 `REGION_NOT_FOUND` becomes a `RegionNotFoundError`. A 409 `REGION_IN_USE` becomes a `RegionInUseError`, and a 409 `REGION_NOT_ACTIVE` becomes a `RegionNotActiveError`.

### Patch Changes

- b47f84f: Declare sibling `@stratum-hq/*` dependencies with caret ranges instead of `"*"` or `>=`. An install now gets a sibling version that has the API the package calls, and never a future major version.
- ac561f9: Remove the unused `lru-cache` dependency. The SDK cache in `src/cache.ts` has its own implementation, so installs of `@stratum-hq/sdk` no longer pull in `lru-cache`.
- Updated dependencies [7e9ebcf]
- Updated dependencies [329cb16]
- Updated dependencies [e7e7b74]
- Updated dependencies [329cb16]
- Updated dependencies [cd7b950]
- Updated dependencies [694a3d3]
- Updated dependencies [694a3d3]
  - @stratum-hq/core@1.4.0

## 1.1.0

### Minor Changes

- dca0826: Harden tenant resolution in the SDK middleware and align the tenant context response with the documented shape (GHSA-4m57-6j5q-w3fv). `jsonwebtoken` is now declared as an optional peer dependency of `@stratum-hq/sdk`, needed only when `jwtSecret` is used.

### Patch Changes

- Updated dependencies [dca0826]
  - @stratum-hq/core@1.3.0

## 1.0.1

### Patch Changes

- d78d839: Tighten the middleware parameter types from `any` to minimal structural types.

  `expressMiddleware` and `fastifyPlugin` previously typed their framework arguments (`req`/`res`/`next` and `fastify`/`request`/`reply`/`done`) as `any`. They now use small structural `*Like` types so the SDK keeps no hard dependency on `express`/`fastify` types. This is a backward-compatible, type-only refinement with no runtime change: real Express and Fastify objects still satisfy the shapes.

- Updated dependencies [36f69d8]
  - @stratum-hq/core@1.2.1

## 1.0.0

### Major Changes

- c17b1a5: Rename the `TenantContextLegacy` type to `ResolvedTenantContext` (#219, from the #133 v1.0 surface review).

  The 1.0 public surface should carry no "Legacy" name. The flat, resolved per-request tenant context (fields `tenant_id`, `ancestry_path`, `depth`, `resolved_config`, `resolved_permissions`, `isolation_strategy`) is now `ResolvedTenantContext`, which sits with the existing `Resolved*` family and is clearly distinct from the richer object-graph `TenantContext`. The type is renamed at its definition in `@stratum-hq/core`, in the `@stratum-hq/sdk` re-export, and in every internal use. No deprecated alias is kept.

  If you import `TenantContextLegacy` from `@stratum-hq/core` or `@stratum-hq/sdk`, or annotate values from `Stratum.currentTenantContext()` / `Stratum.runWithTenant()` or the SDK/Hono middleware with it, switch to `ResolvedTenantContext`. The shape is unchanged.

- c17b1a5: Stop exporting the raw `tenantStorage` `AsyncLocalStorage` instance from `@stratum-hq/sdk` (#219, from the #133 v1.0 surface review).

  `tenantStorage` leaked an internal store that let consumers reach into request context directly. The intended surface is `getTenantContext`, `runWithTenantContext`, and `setTenantContext`, which remain exported. If you used `tenantStorage` directly, switch to those helpers.

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
  - @stratum-hq/core@1.0.0

## 0.3.0

### Minor Changes

- Security hardening release plus ecosystem polish: NestJS ALS context-leak fix, SSRF-safe webhook validation, production JWT/HKDF enforcement, fail-closed ORM adapters, SHA-pinned CI (#84); `create --preset` architecture with ORM-aware generators and Stack Wizard (#85); scaffolded projects now target Next 15 / React 19 / NestJS 11; MIT LICENSE and READMEs shipped in every package; dependency security bumps across the workspace.

### Patch Changes

- Updated dependencies
  - @stratum-hq/core@0.3.0
