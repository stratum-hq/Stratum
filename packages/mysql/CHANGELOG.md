# @stratum-hq/mysql

## 0.5.0

### Minor Changes

- 4c1686a: Tighten tenant scoping (GHSA-fxg8-jqvx-hpc5). Behavior changes: withTenantScope now throws on joins, union()/unionAll() and modify(); the TypeORM subscriber refuses upserts on tables whose unique keys lack tenant_id; MysqlTableAdapter.scopedTable throws without baseTables.
- 4c1686a: Scope TypeORM writes to the current tenant (GHSA-fxg8-jqvx-hpc5). Behavior changes: registerStratumSubscriber adds the tenant condition to update, delete and soft-delete query builders and refuses them outside a tenant context; save() of a row that belongs to another tenant throws; TRUNCATE (clear(), clearTable()) of a tenant table is refused; a subscriber added to dataSource.subscribers by hand now refuses every UPDATE and DELETE.

### Patch Changes

- Updated dependencies [4c1686a]
- Updated dependencies [4c1686a]
  - @stratum-hq/sdk@1.3.0
  - @stratum-hq/core@1.5.0

## 0.4.0

### Minor Changes

- f5936fb: Add `registerStratumSubscriber(dataSource)`. It adds one `StratumTypeOrmSubscriber` to an initialized TypeORM data source, and a second call adds nothing. The subscriber now also rejects a TypeORM upsert whose conflict update writes `tenant_id`, so an upsert cannot give an existing row a different tenant.

### Patch Changes

- b47f84f: Declare sibling `@stratum-hq/*` dependencies with caret ranges instead of `"*"` or `>=`. An install now gets a sibling version that has the API the package calls, and never a future major version.
- e7e7b74: `MysqlPoolManager` no longer creates a duplicate pool when two first requests for one tenant arrive while the manager is at `maxPools`.

  - Concurrent first requests for one tenant now share one pool. Before, each request could create its own pool, and the manager lost track of the extra pool, which stayed open.
  - Each `getPool` call now counts as one hold, also when it waits for a pool that another request is creating. Eviction skips a held pool.
  - A release for a pool that `closePool` or `closeAll` removed no longer releases the new pool for the same tenant.
  - If ending an evicted pool fails, the request that caused the eviction no longer fails. The manager ignores that error.
  - `releasePool` now records the time of the release. The idle timeout counts from the end of the last use, as in the MongoDB and PostgreSQL pool managers. Before, a pool held for longer than `idleTimeoutMs` could close soon after its release.
  - If one pool fails to end during the idle cleanup, the manager still closes the other idle pools, and the error does not become an unhandled promise rejection.
  - `typeorm` (`^1.0.0`) and `sequelize` (`^6.0.0`) are now declared as optional peer dependencies. Before, `peerDependenciesMeta` named them, but `peerDependencies` did not.

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

- dca0826: Harden the TypeORM subscriber tenant handling (GHSA-62pj-p2pf-4mvh).

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

## 0.1.1

### Patch Changes

- Security hardening: fix NestJS tenant context leak, SSRF bypass in webhook delivery, RLS session scoping, fail-closed DB adapters, JWT secret hardening, tenant endpoint scoping, Knex INSERT injection, GitHub Actions pinning
