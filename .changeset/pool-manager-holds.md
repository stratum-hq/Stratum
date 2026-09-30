---
"@stratum-hq/db-adapters": patch
"@stratum-hq/mongodb": patch
---

The per-tenant pool managers no longer create duplicate connections or close connections in use.

- Concurrent first requests for one tenant now share one pool (`DatabasePoolManager`) or one client (`MongoPoolManager`). Before, each request could create its own, and the extra ones stayed open.
- `getPool` and `getClient` now hold the pool or client until the caller calls the new `releasePool` or `releaseClient`. Eviction skips a held entry, so the count can go above `maxPools` or `maxClients` while every entry is in use. A pool or client that the caller never releases stays open until `closePool`/`closeClient` or `closeAll`.
- `MongoDatabaseAdapter` has a new `releaseDatabase(slug)`. Call it once for each `getDatabase(slug)`. `DatabaseRawAdapter` releases its pool after each call.
- `MongoPoolManager` now applies `idleTimeoutMs`. It closes a client that no caller holds after the client stays unused for longer than that time.
