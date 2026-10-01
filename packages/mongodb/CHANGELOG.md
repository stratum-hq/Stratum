# @stratum-hq/mongodb

## 0.6.0

### Minor Changes

- 508c6b8: The scoped `watch()` of `stratumPlugin` can now deliver delete events. Pass `{ watchDeletes: true }` to the plugin. The stream then reads the tenant of a delete event from its change stream pre-image, and delivers the event only to the tenant that owned the document. The option needs MongoDB 6.0 or later and `changeStreamPreAndPostImages` enabled on the collection. If the collection has no pre-images, the stream emits a clear error and closes. Without the option, the behavior does not change.

## 0.5.0

### Minor Changes

- 4c1686a: Tighten tenant scoping (GHSA-fxg8-jqvx-hpc5). Behavior changes: stratumPlugin replaces Model.watch() with a tenant-filtered change stream that drops delete, drop, rename and invalidate events and throws without a tenant context, and refuses a schema that already defines watch(); aggregate cursors run the pipeline as checked; MongoCollectionAdapter.scopedCollection throws without baseCollections.

### Patch Changes

- Updated dependencies [4c1686a]
- Updated dependencies [4c1686a]
  - @stratum-hq/sdk@1.3.0
  - @stratum-hq/core@1.5.0

## 0.4.0

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
- Updated dependencies [7e9ebcf]
- Updated dependencies [329cb16]
- Updated dependencies [b47f84f]
- Updated dependencies [e7e7b74]
- Updated dependencies [329cb16]
- Updated dependencies [cd7b950]
- Updated dependencies [e7e7b74]
- Updated dependencies [ac561f9]
- Updated dependencies [ac561f9]
- Updated dependencies [ac561f9]
- Updated dependencies [329cb16]
- Updated dependencies [694a3d3]
- Updated dependencies [694a3d3]
  - @stratum-hq/core@1.4.0
  - @stratum-hq/sdk@1.2.0

## 0.3.0

### Minor Changes

- dca0826: Harden MongoDB tenant scoping in the shared-collection proxy and Mongoose plugin, and make `assertMongoIsolation` run through the adapter under test (GHSA-699c-qcjr-hw36).

### Patch Changes

- dca0826: Harden tenant filtering and per-tenant purge in the MySQL and MongoDB adapters (GHSA-62pj-p2pf-4mvh).
- Updated dependencies [dca0826]
- Updated dependencies [dca0826]
  - @stratum-hq/sdk@1.1.0
  - @stratum-hq/core@1.3.0

## 0.2.1

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
