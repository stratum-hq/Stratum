# @stratum-hq/mysql

## 0.6.1

### Patch Changes

- b737034: Improve the npm metadata so that npm search finds the packages. Each `description` now starts with the problem the package solves. Each package carries the same multi-tenancy keywords, including `multitenancy`. The `homepage` field now points at the package's page on https://docs.stratum-hq.org instead of a GitHub folder. The first lines of each README link the documentation. No code changes.
- a1bd9aa: Replace em dashes in user-visible text with ordinary punctuation. This touches READMEs, package descriptions, CLI output, control plane startup log messages, the text that `@stratum-hq/create` writes into generated projects, and the assertion messages in `@stratum-hq/test-utils`. The CLI `health` and `migrate` tables now print `no` instead of a dash for an unset flag. No behavior changes.
- Updated dependencies [b737034]
- Updated dependencies [a1bd9aa]
  - @stratum-hq/core@1.5.1
  - @stratum-hq/sdk@1.3.1

## 0.6.0

### Minor Changes

- 2930b1a: withMysqlTenantScope scopes Sequelize models to the tenant (GHSA-v3rm-2g9r-cgfg). In 0.5.0 it only set the @stratum_tenant_id session variable, which nothing filters on. Behavior changes inside the callback, for models with a tenant_id attribute:

  - finds, counts and aggregates return only the tenant's rows, and every include of a tenant model is filtered in its join condition, including includes added by default or named scopes, by an included model's default scope, by `include: { all: true }` and by hooks; a scope's own where clause is kept;
  - bulk update, destroy, restore, increment and decrement change only the tenant's rows; `update()`, `destroy()` and `increment()` without a where clause are refused by Sequelize, as outside the helper;
  - updates never write tenant_id, whether it is given by attribute name or column name, in any letter case, and it is removed from a `fields` list; increment and decrement of tenant_id are refused;
  - creates and `bulkCreate()` write the tenant's tenant_id, also when a `fields` list leaves it out;
  - save, destroy and restore of an instance whose row belongs to another tenant, or of an existing instance of a model without a primary key, throw;
  - upsert, bulkCreate with updateOnDuplicate, truncate, and `or: true` or `right: true` on an include of a tenant model are refused;
  - a query that carries a tenant model but bypasses these methods throws, including inside model hooks, and a query whose tenant condition a hook removed (by replacing the where clause or adding includes late) is refused.

  The helper throws when it is not given a Sequelize v6 instance.

- 2930b1a: Enforce TypeORM tenant rules in the query builders (GHSA-v3rm-2g9r-cgfg). Behavior changes on a registered data source: inserts get the current tenant and updates drop tenant_id even with listeners off (`save(…, { listeners: false })`, `.callListeners(false)`); the tenant is written to whichever entity property maps to the tenant_id column, and a relation whose join column is tenant_id cannot set or change it (on insert it is removed, on update it is dropped); an insert whose primary key belongs to another tenant's row throws "insert refused" with or without listeners; INSERT … SELECT (`valuesFromSelect()`) into a tenant entity is refused, and into other tables a tenant-scoped SELECT keeps its tenant parameter; view entities built from a query builder are created by `synchronize()` without the tenant condition, while reads from a view with a tenant_id column stay scoped.
- 2930b1a: Scope TypeORM reads to the current tenant (GHSA-v3rm-2g9r-cgfg). Behavior changes: on a data source registered with registerStratumSubscriber, reads of entities with a tenant_id column (repository find, findOne, count, exists and aggregates, query builder getMany, getOne, getRawMany, getRawOne, getCount, getManyAndCount, getExists and stream, relation loading, and the row save() loads) now return only the current tenant's rows, joined tenant entities are filtered in the join condition, and such reads are refused outside a tenant context. Background jobs, scripts and workers that read tenant entities through a registered data source must now run inside a tenant context (runWithTenantContext), one tenant at a time. save() with the key of another tenant's row still throws, and an insert() whose primary key belongs to another tenant's row now throws the same Stratum error instead of a duplicate key error. Registration throws if the TypeORM select query builder cannot be scoped.

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
