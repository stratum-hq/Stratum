# @stratum-hq/control-plane

## 1.3.0

### Minor Changes

- 4c1686a: The control plane's JWT_SECRET presence, length and placeholder checks now apply in every environment other than `development` and `test`, not only `production` (GHSA-p3jw-vw8m-3rqr).
- 4c1686a: Every control-plane route now declares its required scope in route config, and a route without a declaration is refused (GHSA-p3jw-vw8m-3rqr).
- 4c1686a: Control-plane migrations enforce RLS, and the missing `JWT_AUDIENCE` warning fires, in every environment other than `development` and `test` (an unset `NODE_ENV` counts as `development`) (GHSA-jx2p-pffr-c5gh).
- 4c1686a: Global operator API keys now receive tenant-state errors (403 `TENANT_SUSPENDED`, 410 `TENANT_ARCHIVED`, 409 `TENANT_PENDING`) on config, permission, webhook and consent writes to a tenant that is not active, and usage events are refused for a tenant that is not active (GHSA-54ff-f8q6-8mfx).

### Patch Changes

- 4c1686a: Authenticated requests to a path that matches no route now get 404 instead of 403; unauthenticated requests still get 401, and matched routes stay default-deny (GHSA-p3jw-vw8m-3rqr).
- 96e9a3c: An error below 500 that has no Stratum code now gets a code from its status, not `VALIDATION_ERROR`. The codes are `BAD_REQUEST` (400 and any unlisted status), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `PAYLOAD_TOO_LARGE` (413), `UNSUPPORTED_MEDIA_TYPE` (415), and `RATE_LIMITED` (429). A Fastify schema validation error keeps `VALIDATION_ERROR`. A client that read `VALIDATION_ERROR` for a request body that is not valid JSON must now read `BAD_REQUEST`.
- Updated dependencies [4c1686a]
- Updated dependencies [4c1686a]
- Updated dependencies [4c1686a]
- Updated dependencies [4c1686a]
- Updated dependencies [4c1686a]
- Updated dependencies [4c1686a]
- Updated dependencies [4c1686a]
  - @stratum-hq/lib@1.5.0
  - @stratum-hq/core@1.5.0

## 1.2.0

### Minor Changes

- 329cb16: Every 400 `VALIDATION_ERROR` about request fields now lists the failed fields in `error.details.issues`. Each item has `path`, `message` and `code`. Before, a zod failure used `error.issues`, a library `ValidationError` used `error.details.issues`, and the key and role routes used a top-level `details`. The old fields stay as deprecated copies for one release: `error.issues` on every such response, and the top-level `details` on the key and role routes. The deprecated copies now carry the same trimmed issues as `error.details.issues`, with only `path`, `message` and `code`. Before, they carried the raw zod issues, which have more fields that differ per issue code.

  The error handler now finds a `StratumError` by its shape, not by `instanceof`. An error from a second copy of `@stratum-hq/core` keeps its status code, code and details.

- 7e9ebcf: Input schemas are now stricter, and the control plane rejects some requests that it accepted before. This is a deliberate tightening. Some of the values that the schemas now reject were valid in PostgreSQL and succeeded before this release.

  The control plane returns `400 VALIDATION_ERROR` for these values:

  - `CreateAbacPolicyInputSchema.priority` must be in the `INTEGER` range, -2147483648 to 2147483647. Before this release, a value outside that range caused a `500`.
  - `GrantConsentInputSchema.expires_at` must be an ISO 8601 datetime with a time zone (`Z` or an offset such as `+02:00`). `POST /api/v1/tenants/:tenantId/consent` returned `201` for these forms before, and now returns `400`:
    - a date without a time, such as `2027-12-31`
    - a datetime without a time zone, such as `2027-12-31T00:00:00`
    - the PostgreSQL special values `infinity` and `epoch`

    Send a full datetime with a time zone, such as `2027-12-31T00:00:00Z`.

  - `RecordUsageInputSchema.quantity` must be at most `Number.MAX_SAFE_INTEGER` (2^53 - 1). Before this release, a quantity from 2^53 up to the `BIGINT` limit (about 9.2e18) succeeded, and a larger quantity caused a `500`.
  - The datetime fields of `GrantConsentInputSchema`, `RecordUsageInputSchema`, `UsageAggregateQuerySchema`, `AuditLogQuerySchema`, and `RecordAuditEventInputSchema` reject year 0000, which PostgreSQL has no value for.

### Patch Changes

- 7e9ebcf: Request spans now carry the `stratum.tenant_id` attribute for authenticated callers, with API keys and with JWTs. The hook read the tenant before authentication ran, so the attribute was never set. Spans also record the request path without its query string in the span name, `http.url`, and `http.route`. If a client disconnects before the response, the span now ends with an error status. Before this change, it stayed open.
- b47f84f: Declare sibling `@stratum-hq/*` dependencies with caret ranges instead of `"*"` or `>=`. An install now gets a sibling version that has the API the package calls, and never a future major version.
- e7e7b74: Report invalid input as a validation error, not as a server or database error.

  Breaking for some callers: `@stratum-hq/lib` now rejects input that it stored before, and `recordAuditEvent` throws a different error class.

  - `@stratum-hq/lib`: `grantConsent` validates its input with `GrantConsentInputSchema`. It now throws a `ValidationError` and writes no row for:
    - an empty `subject_id` or `purpose`.
    - an `expires_at` that is only a date (`2026-12-31`), or a date and time without a time zone offset (`2026-12-31T00:00:00`). Before, PostgreSQL stored these values, and it read a time without an offset in the time zone of the database session.
    - an `expires_at` that PostgreSQL cannot store, such as `infinity`. Before, the call failed with a PostgreSQL error.
  - `@stratum-hq/lib`: `createAbacPolicy` validates its input with `CreateAbacPolicyInputSchema`. It now throws a `ValidationError` and writes no row for:
    - an empty `name`, `resource_type` or `action`, or a condition with an empty `attribute` or an unknown `operator`. Before, the policy was stored.
    - a `priority` that is not an integer from -2147483648 to 2147483647. Before, the call failed with a PostgreSQL error.
  - `@stratum-hq/lib`: `recordAuditEvent` now throws a `ValidationError` for invalid input, with the zod issues in `details.issues`. Before, it threw a `ZodError`. A check such as `err instanceof ZodError` no longer matches. Check `err instanceof ValidationError` instead.
  - `@stratum-hq/lib`: `recordAuditEvent` now throws a `ValidationError` for a `sourceIp` that is not an IP address. Before, the call failed with a PostgreSQL error.
  - `@stratum-hq/core`: `RecordAuditEventInputSchema.sourceIp` now accepts only an IPv4 or IPv6 address, with an optional `/prefix` (`203.0.113.7`, `10.0.0.0/8`, `2001:db8::1/128`). This matches the `INET` column. The `source_ip` value that `queryAuditLogs` returns, such as `203.0.113.7/32`, is accepted. The schema rejects an IPv6 zone index (`fe80::1%eth0`) and an IPv4 address with leading zeros (`010.0.0.1`). Before, the schema accepted any string.
  - `@stratum-hq/control-plane`: the error handler identifies a `ZodError` by its shape, so a `ZodError` from another copy of zod now gets a `400 VALIDATION_ERROR` response instead of a `500`.

- 329cb16: Region conflicts now throw typed errors instead of a plain `Error`:

  - `deleteRegion` throws `RegionInUseError` (code `REGION_IN_USE`, status code 409) when active tenants are still assigned to the region.
  - `migrateRegion` throws `RegionNotActiveError` (code `REGION_NOT_ACTIVE`, status code 409) when the target region is not `active`.

  `@stratum-hq/lib` now exports `RegionInUseError` and `RegionNotActiveError`. The thrown class changes from `Error` to these `StratumError` subclasses, so a caller can check the class or the `code`. The error messages do not change.

  The control plane now answers `409` with these codes for `DELETE /api/v1/regions/:id` and `POST /api/v1/tenants/:id/migrate-region`. Before, it answered `500 INTERNAL_SERVER_ERROR`.

- cd7b950: A missing region now gives a typed not-found error. Core adds `RegionNotFoundError` with the code `REGION_NOT_FOUND`. Lib re-exports it, the lib region functions throw it, and `migrateRegion` throws `TenantNotFoundError` for a missing tenant. The control plane answers 404 instead of 500 for these requests.
- 7e9ebcf: `rotateEncryptionKey` can now resume after a partial failure.

  The rotation commits in batches. Before this change, a run that failed partway could not be repeated: the second run failed on the first value that was already on the new key. Now the run keeps a value that already decrypts with the new key. It also continues past a value that decrypts with neither key.

  `KeyRotationResult` has two new fields:

  - `already_rotated`: the number of values that already decrypt with the new key.
  - `unreadable`: the rows (`table` and `id`) whose value decrypts with neither key. The run leaves them unchanged.

  `config_entries_rotated` and `webhooks_rotated` now count only the values that this run re-encrypted. A value that was already on the new key counts in `already_rotated`, not in these two fields.

  A rotation with the wrong old key still fails, so the new tolerance for unreadable rows cannot hide a wrong key. If encrypted values exist and none of them decrypts with the old key or the new key, `rotateEncryptionKey` throws a `ValidationError` and changes no row. When some rows decrypt and some do not, the run completes and logs the warning `encryption key rotation left unreadable rows` with the count and the rows.

  The control plane `POST /api/v1/maintenance/rotate-encryption-key` response now has these fields: `config_entries_rotated`, `webhooks_rotated`, `already_rotated`, and `unreadable`. The OpenAPI spec documented a `re_encrypted_count` field, which the endpoint never returned; the spec now shows the real response. The endpoint returns `400 VALIDATION_ERROR` when encrypted values exist and none of them decrypts with either key.

- e7e7b74: Every `tenant_isolation` policy that Stratum generates now reads the tenant with `NULLIF(current_setting('app.current_tenant_id', true), '')::uuid`, the same form as the policies in Stratum's own migrations. This applies to `createPolicy` and `createIsolationPolicy` in `@stratum-hq/db-adapters`, to `stratum migrate` and the SQL from `stratum scan --generate`, and to `setupRLSForTable` in the control plane.

  On a pooled connection, the setting reads as `''` after the transaction that set it ends. Before, a query on that connection with no tenant context failed with `invalid input syntax for type uuid: ""`. Now the query returns no rows.

  Policies that already exist in a database do not change. To update one, drop it and create it again with the new expression.

- 694a3d3: A tenant-scoped API key can now purge a pending child tenant in its own subtree, for example after storage provisioning fails. Before, only an operator key could remove it. `DELETE /api/v1/tenants/:id` on such a tenant now returns the tenant state error (409) instead of 403. Archived and suspended tenants are still refused by the scope check.
- 694a3d3: `POST /api/v1/tenants` now removes the schema or database it provisioned when activation of the new tenant fails. Before this change, the storage stayed behind, and purging the pending tenant did not remove it. The tenant stays `pending`, and the response is `TENANT_PROVISIONING_FAILED` with `details.stage` set to `"activation"`. If the removal also fails, `details.storage_removed` is `false`, and an operator must drop the storage by hand. If the activation reports an error but the tenant is `active`, the route returns the active tenant and keeps its storage. If the route cannot read the tenant after the activation error, it also keeps the storage and returns the original error. Check the tenant's status: if it is `pending`, purge it and drop its storage by hand.

  `TenantProvisioningError` has a new optional second argument that names the failed stage. Its `details` now include `stage` (`"provisioning"` or `"activation"`), and `storage_removed` for the activation stage.

- Updated dependencies [9ed3e01]
- Updated dependencies [b47f84f]
- Updated dependencies [7e9ebcf]
- Updated dependencies [329cb16]
- Updated dependencies [b47f84f]
- Updated dependencies [b47f84f]
- Updated dependencies [e7e7b74]
- Updated dependencies [329cb16]
- Updated dependencies [cd7b950]
- Updated dependencies [7e9ebcf]
- Updated dependencies [9ed3e01]
- Updated dependencies [694a3d3]
- Updated dependencies [694a3d3]
- Updated dependencies [cd7b950]
- Updated dependencies [694a3d3]
  - @stratum-hq/lib@1.4.0
  - @stratum-hq/core@1.4.0

## 1.1.0

### Minor Changes

- dca0826: Create tenants with their own schema or database as pending until provisioned, and drop that storage on purge (GHSA-jhhc-cm2c-jh27).

### Patch Changes

- dca0826: Harden API key lifecycle, JWT binding and rate limiting (GHSA-rqvw-c6qr-6x37).
- dca0826: Harden control-plane authorization for tenant-scoped callers (GHSA-76p7-8h5v-7qxr).
- dca0826: Harden JWT secret startup checks (GHSA-rqvw-c6qr-6x37).
- dca0826: Harden tenant isolation in the schema-per-tenant and database-per-tenant strategies and the Prisma and Drizzle adapters (GHSA-jhhc-cm2c-jh27). Behavior change: the schema-per-tenant `search_path` is now the tenant schema alone, without `public`; queries that call extension functions or types from another schema must schema-qualify them or opt that schema in with the new `extraSearchPath` option.
- dca0826: Harden policy evaluation, revocation and audit handling in the library (GHSA-wf22-q48q-4cjq).
- dca0826: Harden tenant resolution in the SDK middleware and align the tenant context response with the documented shape (GHSA-4m57-6j5q-w3fv). `jsonwebtoken` is now declared as an optional peer dependency of `@stratum-hq/sdk`, needed only when `jwtSecret` is used.
- Updated dependencies [dca0826]
- Updated dependencies [dca0826]
- Updated dependencies [dca0826]
- Updated dependencies [dca0826]
- Updated dependencies [dca0826]
- Updated dependencies [dca0826]
- Updated dependencies [dca0826]
- Updated dependencies [dca0826]
- Updated dependencies [dca0826]
  - @stratum-hq/lib@1.3.0
  - @stratum-hq/core@1.3.0

## 1.0.1

### Patch Changes

- Bump `@fastify/swagger-ui` to clear two real advisories in its `@fastify/static` dependency (non-canonical-path authorization bypass, route-guard bypass via path traversal). The published package previously pinned `@fastify/swagger-ui: ^5.2.0`, whose `@fastify/static` range could never reach the patched version. No API or behavior change to the `/api/docs` route.
- Updated dependencies [36f69d8]
  - @stratum-hq/core@1.2.1
  - @stratum-hq/lib@1.2.1

## 1.0.0

### Major Changes

- 5e87692: Unify API-key scope resolution and make scope checks hierarchical (FR-53, #132).

  Two authorization-semantics changes land together:
  - **Hierarchical scopes.** Scope requirements are now checked with a rank
    comparison (`read` < `write` < `admin`) instead of flat set membership, so
    `admin` implies `write` implies `read`. A key minted as `["admin"]` or
    `["write"]` now satisfies the lower-scope routes it previously failed. A new
    `scopeSatisfies(granted, required)` helper in `@stratum-hq/core` is the single
    scope-check primitive; the control-plane authorize middleware uses it. This
    changes same-tenant behavior by scope level only and does not alter any
    cross-tenant boundary.
  - **Single scope source.** `validateApiKey` (the auth boundary) and
    `resolveKeyScopes` now resolve scopes through one `resolveEffectiveScopes`
    function: an assigned role's scopes govern; otherwise the key's own column
    scopes apply; a key with neither defaults to `["read"]`. Previously
    `validateApiKey` read the `api_keys.scopes` column and ignored an assigned
    role, so assigning a role had no effect on control-plane authorization.
    Assigning a role now governs the key's authorization everywhere, which can
    narrow a key whose role is narrower than its column scopes. Keys without a role
    are unaffected.

  Both are breaking changes to authorization behavior; audit any key that carries a
  role alongside column scopes, and mint keys with the scopes the caller actually
  needs. See the migration guide sections 5.2 and 5.3 in `docs/v1.0-api-surface.md`.

### Minor Changes

- c17b1a5: Add an `exports` map to `@stratum-hq/control-plane` and `@stratum-hq/cli` so deep imports no longer resolve (#219, from the #133 v1.0 surface review).

  Neither package is a JS import surface: `@stratum-hq/control-plane` is a deployable server whose `index` calls `main()` on import (its 1.0 contract is the HTTP REST API and OpenAPI document), and `@stratum-hq/cli` is a bin whose contract is its command surface. Both now expose only their documented entry (`.`) and block accidental deep imports such as `@stratum-hq/control-plane/dist/routes/...`. The `stratum` bin and `node dist/index.js` startup are unchanged. If you deep-imported internals from either package (never a supported path), import from the package entry instead.

### Patch Changes

- b55ae70: Correct and complete package metadata for the npm registry listing.

  Every published package now declares `license` (MIT), `author`, `homepage`, and
  `bugs`. Runtime packages declare `engines` (Node >=20) to match the project's
  support policy; this fixes `@stratum-hq/cli`, which previously declared Node >=18.
  `@stratum-hq/mysql` and `@stratum-hq/mongodb` gain the `keywords` array they were
  missing. No runtime code changes.

- 4adcbb5: Stop shipping test files in published tarballs. tsc-built packages now exclude **tests** directories and .test/.spec files from compilation, so dist and the tarball contain only real package output. The create package, which ships source for its ./matrix export, excludes tests via .npmignore instead. The vitest runner is unaffected and still runs tests from src.
- Updated dependencies [b55ae70]
- Updated dependencies [4eb1c52]
- Updated dependencies [c17b1a5]
- Updated dependencies [c17b1a5]
- Updated dependencies [3fa212b]
- Updated dependencies [86dfbe1]
- Updated dependencies [5e87692]
- Updated dependencies [f071f49]
- Updated dependencies [4adcbb5]
- Updated dependencies [c17b1a5]
  - @stratum-hq/lib@1.0.0
  - @stratum-hq/core@1.0.0

## 0.4.0

### Minor Changes

- ab53239: Enforce default-deny authorization on the control plane. Every route must declare its tenant scope; a route that declares none is refused, so a route added without a guard fails closed rather than serving data.
- f96c3b4: Scope the config diff and role administration routes to the caller key's subtree. A tenant-scoped API key may now diff and administer roles only within its own tenant and descendants: the config diff authorizes both compared tenants (query `tenant_a`/`tenant_b`), role create/list authorize the tenant read from the body/query, and the role-by-id and role-assignment routes authorize the target role's and API key's owning tenant. Global operator keys (tenant_id null) keep full access.

### Patch Changes

- 4c53aa5: Harden control-plane authorization. Admin-scope enforcement is evaluated from the resolved request path. Tenant creation is confined to the caller's key scope: a tenant-scoped key may only create tenants within its own subtree and may not create new root tenants, while global (operator) keys remain unrestricted. The batch create route is authorized the same way as single create.
- Updated dependencies [eaffc2d]
- Updated dependencies [f96c3b4]
- Updated dependencies [718d977]
- Updated dependencies [abc555d]
- Updated dependencies [e46ffeb]
  - @stratum-hq/lib@0.6.0

## 0.3.0

### Minor Changes

- Security hardening release plus ecosystem polish: NestJS ALS context-leak fix, SSRF-safe webhook validation, production JWT/HKDF enforcement, fail-closed ORM adapters, SHA-pinned CI (#84); `create --preset` architecture with ORM-aware generators and Stack Wizard (#85); scaffolded projects now target Next 15 / React 19 / NestJS 11; MIT LICENSE and READMEs shipped in every package; dependency security bumps across the workspace.

### Patch Changes

- Updated dependencies
  - @stratum-hq/core@0.3.0
  - @stratum-hq/lib@0.3.0

## 0.2.4

### Patch Changes

- Security hardening: fix NestJS tenant context leak, SSRF bypass in webhook delivery, RLS session scoping, fail-closed DB adapters, JWT secret hardening, tenant endpoint scoping, Knex INSERT injection, GitHub Actions pinning
- Updated dependencies
  - @stratum-hq/lib@0.2.4
