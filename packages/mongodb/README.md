# @stratum-hq/mongodb

MongoDB tenant isolation adapters for Stratum.

Three isolation strategies:
- **Shared collection** — tenant_id field injection via Collection Proxy
- **Collection-per-tenant** — `{collection}_{slug}` naming convention. Pass `baseCollections` (every base collection name) to `MongoCollectionAdapter`; `purgeTenantData` requires it and purges exactly `{base}_{slug}` for each entry
- **Database-per-tenant** — dedicated database with MongoPoolManager LRU cache

## Installation

```bash
npm install @stratum-hq/mongodb mongodb
```

## Database-per-tenant clients

`MongoDatabaseAdapter` keeps one `MongoClient` for each tenant, through `MongoPoolManager`. Each `getDatabase(slug)` call holds the tenant's client until you call `releaseDatabase(slug)`. The manager never closes a held client. Thus an operation in progress cannot lose its client.

```typescript
const db = await adapter.getDatabase("acme");
try {
  await db.collection("orders").insertOne({ total: 10 });
} finally {
  adapter.releaseDatabase("acme");
}
```

- When the client count reaches `maxClients`, the manager closes the least recently used client that no caller holds.
- The manager closes a client that no caller holds after it stays unused for longer than `idleTimeoutMs` (default 60000).
- If every client is held, the count goes above `maxClients` until a caller releases one.
- A client that you never release stays open until `purgeTenantData` or `closeAll`.

Concurrent first requests for one tenant share one client. `MongoPoolManager` has the same contract through `getClient` and `releaseClient`.
