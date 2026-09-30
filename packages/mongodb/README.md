# @stratum-hq/mongodb

MongoDB tenant isolation adapters for Stratum.

Three isolation strategies:
- **Shared collection** — tenant_id field injection via Collection Proxy
- **Collection-per-tenant** — `{collection}_{slug}` naming convention. Pass `baseCollections` (every base collection name) to `MongoCollectionAdapter`; `scopedCollection` and `purgeTenantData` require it, and `purgeTenantData` purges exactly `{base}_{slug}` for each entry
- **Database-per-tenant** — dedicated database with MongoPoolManager LRU cache

## Mongoose plugin scope

`stratumPlugin` scopes every Mongoose query, `insertMany`, `bulkWrite`, `aggregate` and `save` to the current tenant, and replaces the model's `watch()` with a change stream that starts with `$match: { "fullDocument.tenant_id": <tenant> }`. `fullDocument` defaults to `"updateLookup"` so update events carry the document; events without a `fullDocument` (such as deletes) are filtered out. An `Aggregate` cannot be changed after it has run.

`Model.collection`, `Model.db`, `connection.db` and `connection.watch()` are the raw driver objects and are **not** scoped: they see every tenant's data. Use them only for admin work, never with tenant input.

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
