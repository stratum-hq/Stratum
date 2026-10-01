# @stratum-hq/db-adapters

## 1.3.0

### Minor Changes

- 2930b1a: `createPolicy` now checks every permissive policy on the table, and that an existing `tenant_isolation` policy applies to PUBLIC, and throws instead of adding or keeping a policy when any of them does not filter by tenant. `isRLSEnabled` now reports on the table the name resolves to, schema included, and rejects invalid table names (GHSA-v3rm-2g9r-cgfg).

## 1.2.0

### Minor Changes

- 9ed3e01: The per-tenant pool managers no longer create duplicate connections or close connections in use.

  **Action required:** if you call `DatabasePoolManager.getPool`, `MongoPoolManager.getClient` or `MongoDatabaseAdapter.getDatabase` directly, you must call the matching `releasePool`, `releaseClient` or `releaseDatabase` once for each call, when you no longer use the result. Put the release in a `finally` block. If you do not release, the manager never evicts that pool or client, and it stays open until `closePool`/`closeClient` or `closeAll`. `DatabaseRawAdapter` does this for you.

  - Concurrent first requests for one tenant now share one pool (`DatabasePoolManager`) or one client (`MongoPoolManager`). Before, each request could create its own, and the extra ones stayed open.
  - `getPool` and `getClient` now hold the pool or client until the caller calls the new `releasePool` or `releaseClient`. Eviction skips a held entry, so the count can go above `maxPools` or `maxClients` while every entry is in use.
  - `MongoDatabaseAdapter` has a new `releaseDatabase(slug)`. Call it once for each `getDatabase(slug)`.
  - Without a `regionId`, `releasePool(slug)` also releases the one region-prefixed pool for that slug, as `closePool(slug)` does. If the slug has pools in more than one region, it releases nothing. Pass the `regionId` in that case.
  - A release for a pool or client that `closePool`, `closeClient` or `closeAll` removed no longer releases the new pool or client for the same tenant.
  - If closing an evicted pool or client fails, the request that caused the eviction no longer fails. The manager ignores that error, as the idle check does.
  - `MongoPoolManager` now applies `idleTimeoutMs`. It closes a client that no caller holds after the client stays unused for longer than that time. `0` or `Infinity` turns the idle check off. A negative value or `NaN` throws a `RangeError`.

### Patch Changes

- b47f84f: Declare sibling `@stratum-hq/*` dependencies with caret ranges instead of `"*"` or `>=`. An install now gets a sibling version that has the API the package calls, and never a future major version.
- e7e7b74: Every `tenant_isolation` policy that Stratum generates now reads the tenant with `NULLIF(current_setting('app.current_tenant_id', true), '')::uuid`, the same form as the policies in Stratum's own migrations. This applies to `createPolicy` and `createIsolationPolicy` in `@stratum-hq/db-adapters`, to `stratum migrate` and the SQL from `stratum scan --generate`, and to `setupRLSForTable` in the control plane.

  On a pooled connection, the setting reads as `''` after the transaction that set it ends. Before, a query on that connection with no tenant context failed with `invalid input syntax for type uuid: ""`. Now the query returns no rows.

  Policies that already exist in a database do not change. To update one, drop it and create it again with the new expression.

- 9ed3e01: `SchemaRawAdapter.executeWithTenantContext` now releases the connection when `ROLLBACK` or `RESET search_path` fails. Before, a failed RESET skipped `client.release()`, so the pool lost the connection. A failed ROLLBACK or RESET also replaced the result or the original error. Now the adapter keeps the result or the original error, and pg-pool removes the connection from the pool instead of reusing it.

  `DatabaseRawAdapter.executeWithTenantContext` now does the same when `ROLLBACK` fails: it rethrows the original error and pg-pool removes the connection from the pool.

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

- dca0826: Harden tenant isolation in the schema-per-tenant and database-per-tenant strategies and the Prisma and Drizzle adapters (GHSA-jhhc-cm2c-jh27). Behavior change: the schema-per-tenant `search_path` is now the tenant schema alone, without `public`; queries that call extension functions or types from another schema must schema-qualify them or opt that schema in with the new `extraSearchPath` option.

### Patch Changes

- 9de2ddb: Republish so the README on npm matches the 1.0 API. The 1.0.0 README showed the pre-1.0 names `withTenant`, `withDrizzleTenant` and `withTenantScope`; the package exports `prismaWithTenant`, `drizzleWithTenant` and `sequelizeWithTenantScope`.
- Updated dependencies [dca0826]
  - @stratum-hq/core@1.3.0

## 1.0.0

### Major Changes

- c17b1a5: Give the `@stratum-hq/db-adapters` barrel one consistent naming scheme for the tenant-context helpers (#219, from the #133 v1.0 surface review).

  The barrel previously exposed the same "run in tenant context" concept under colliding names patched over with `as` aliases. The 1.0 names use an `<orm>` prefix so no export is an alias workaround:
  - `withTenant` (Prisma) -> `prismaWithTenant`
  - `withDrizzleTenant` -> `drizzleWithTenant`
  - `withTenantScope` (Sequelize) -> `sequelizeWithTenantScope`
  - `withDrizzleTenantScope` -> `drizzleWithTenantScope`
  - `enableRLSMigration` (migration helper) -> `enableRLSForMigration` (distinct from the runtime `enableRLS`)

  Behavior is identical; only the exported names change. The `@stratum-hq/cli` and `@stratum-hq/create` scaffolding templates emit the new `prismaWithTenant` name. Update your imports to the new names.

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

## 0.4.0

### Minor Changes

- 523abeb: Enforce the `SHARED_RLS` isolation strategy with real Postgres row-level security.

  Migration `019_rls_policies.sql` enables `ROW LEVEL SECURITY` (with `FORCE`) and a
  tenant-isolation policy on every tenant-scoped shared-schema table, so tenant
  isolation is enforced by the database as a second layer independent of the
  application's `WHERE tenant_id` filters. Context is set per transaction with
  `SET LOCAL` (`app.current_tenant_id`), and a `withRlsBypass` helper (new, exported
  from `@stratum-hq/db-adapters` alongside `withTenantContext`) provides the audited
  system path for control-plane cross-tenant operations.

  Rollout note: after this migration runs, any client connecting as a non-superuser,
  non-`BYPASSRLS` role must set the tenant context (`withTenantContext`) or use a
  bypass, or its direct queries against the protected tables return zero rows. Do not
  enable this against a shared database until every direct client has adopted the
  tenant-context helper. See `docs/adr/0001-postgres-rls-defense-in-depth.md`.

## 0.3.1

### Patch Changes

- abc555d: Fix encryption key rotation to re-encrypt every sensitive row exactly once. Rotation now walks config entries and webhook secrets with a keyset cursor over the primary key, so datasets larger than a single batch are rotated fully and correctly instead of stalling after the first batch.

  Validate the tenant slug in `setSchemaSearchPath` before it is used to build the schema identifier, matching the other schema-isolation adapters. Identifiers outside the canonical slug charset are now rejected rather than interpolated into the search-path statement.

## 0.3.0

### Minor Changes

- Security hardening release plus ecosystem polish: NestJS ALS context-leak fix, SSRF-safe webhook validation, production JWT/HKDF enforcement, fail-closed ORM adapters, SHA-pinned CI (#84); `create --preset` architecture with ORM-aware generators and Stack Wizard (#85); scaffolded projects now target Next 15 / React 19 / NestJS 11; MIT LICENSE and READMEs shipped in every package; dependency security bumps across the workspace.

### Patch Changes

- Updated dependencies
  - @stratum-hq/core@0.3.0

## 0.2.4

### Patch Changes

- Security hardening: fix NestJS tenant context leak, SSRF bypass in webhook delivery, RLS session scoping, fail-closed DB adapters, JWT secret hardening, tenant endpoint scoping, Knex INSERT injection, GitHub Actions pinning
