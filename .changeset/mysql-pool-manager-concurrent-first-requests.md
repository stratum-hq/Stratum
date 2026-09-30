---
"@stratum-hq/mysql": patch
---

`MysqlPoolManager` no longer creates a duplicate pool when two first requests for one tenant arrive while the manager is at `maxPools`.

- Concurrent first requests for one tenant now share one pool. Before, each request could create its own pool, and the manager lost track of the extra pool, which stayed open.
- Each `getPool` call now counts as one hold, also when it waits for a pool that another request is creating. Eviction skips a held pool.
- If ending an evicted pool fails, the request that caused the eviction no longer fails. The manager ignores that error.
- `typeorm` (`^1.0.0`) and `sequelize` (`^6.0.0`) are now declared as optional peer dependencies. Before, `peerDependenciesMeta` named them, but `peerDependencies` did not.
