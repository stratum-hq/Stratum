---
"@stratum-hq/db-adapters": minor
"@stratum-hq/mongodb": minor
---

The per-tenant pool managers no longer create duplicate connections or close connections in use.

**Action required:** if you call `DatabasePoolManager.getPool`, `MongoPoolManager.getClient` or `MongoDatabaseAdapter.getDatabase` directly, you must call the matching `releasePool`, `releaseClient` or `releaseDatabase` once for each call, when you no longer use the result. Put the release in a `finally` block. If you do not release, the manager never evicts that pool or client, and it stays open until `closePool`/`closeClient` or `closeAll`. `DatabaseRawAdapter` does this for you.

- Concurrent first requests for one tenant now share one pool (`DatabasePoolManager`) or one client (`MongoPoolManager`). Before, each request could create its own, and the extra ones stayed open.
- `getPool` and `getClient` now hold the pool or client until the caller calls the new `releasePool` or `releaseClient`. Eviction skips a held entry, so the count can go above `maxPools` or `maxClients` while every entry is in use.
- `MongoDatabaseAdapter` has a new `releaseDatabase(slug)`. Call it once for each `getDatabase(slug)`.
- Without a `regionId`, `releasePool(slug)` also releases the one region-prefixed pool for that slug, as `closePool(slug)` does. If the slug has pools in more than one region, it releases nothing. Pass the `regionId` in that case.
- A release for a pool or client that `closePool`, `closeClient` or `closeAll` removed no longer releases the new pool or client for the same tenant.
- If closing an evicted pool or client fails, the request that caused the eviction no longer fails. The manager ignores that error, as the idle check does.
- `MongoPoolManager` now applies `idleTimeoutMs`. It closes a client that no caller holds after the client stays unused for longer than that time. `0` or `Infinity` turns the idle check off. A negative value or `NaN` throws a `RangeError`.
