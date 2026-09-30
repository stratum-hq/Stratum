---
"@stratum-hq/mysql": patch
---

`MysqlPoolManager` no longer creates a duplicate pool when two first requests for one tenant arrive while the manager is at `maxPools`.

- Concurrent first requests for one tenant now share one pool. Before, each request could create its own pool, and the manager lost track of the extra pool, which stayed open.
- Each `getPool` call now counts as one hold, also when it waits for a pool that another request is creating. Eviction skips a held pool.
- A release for a pool that `closePool` or `closeAll` removed no longer releases the new pool for the same tenant.
- If ending an evicted pool fails, the request that caused the eviction no longer fails. The manager ignores that error.
- `releasePool` now records the time of the release. The idle timeout counts from the end of the last use, as in the MongoDB and PostgreSQL pool managers. Before, a pool held for longer than `idleTimeoutMs` could close soon after its release.
- If one pool fails to end during the idle cleanup, the manager still closes the other idle pools, and the error does not become an unhandled promise rejection.
- `typeorm` (`^1.0.0`) and `sequelize` (`^6.0.0`) are now declared as optional peer dependencies. Before, `peerDependenciesMeta` named them, but `peerDependencies` did not.
