# @stratum-hq/mongodb

MongoDB tenant isolation adapters for Stratum.

Three isolation strategies:
- **Shared collection:** tenant_id field injection via Collection Proxy
- **Collection-per-tenant:** `{collection}_{slug}` naming convention. Pass `baseCollections` (every base collection name) to `MongoCollectionAdapter`; `scopedCollection` and `purgeTenantData` require it, and `purgeTenantData` purges exactly `{base}_{slug}` for each entry
- **Database-per-tenant:** dedicated database with MongoPoolManager LRU cache

## Mongoose plugin scope

`stratumPlugin` scopes every Mongoose query, `insertMany`, `bulkWrite`, `aggregate` and `save` to the current tenant, and replaces the model's `watch()` with a change stream that starts with `$match: { "fullDocument.tenant_id": <tenant> }`. `fullDocument` defaults to `"updateLookup"` so update events carry the document. An `Aggregate` cannot be changed after it has run.

**Limitation:** the scoped `watch()` drops every change event that has no `fullDocument`, including delete, drop, rename and invalidate events, because it cannot tell which tenant they belong to. To receive delete events, use the `watchDeletes` option below. It throws without a tenant context. The plugin refuses a schema that already defines a `watch()` static; a `watch()` static added after the plugin replaces the scoped one.

`Model.collection`, `Model.db`, `connection.db` and `connection.watch()` are the raw driver objects and are **not** scoped: they see every tenant's data. Use them only for admin work, never with tenant input.

### Delete events from `watch()`

A delete event has no `fullDocument`. With `watchDeletes: true`, the scoped `watch()` reads the tenant of a delete event from its pre-image, and delivers the event only to the tenant that owned the document. Drop, rename and invalidate events stay dropped.

This option needs:

- MongoDB 6.0 or later, as a replica set or a sharded cluster. Change streams do not run on a standalone server.
- Change stream pre-images enabled on the collection.

Enable the pre-images on the collection first:

```typescript
await connection.db.command({
  collMod: "orders",
  changeStreamPreAndPostImages: { enabled: true },
});
// For a new collection:
// await connection.createCollection("orders", { changeStreamPreAndPostImages: { enabled: true } });
```

Then pass the option to the plugin:

```typescript
orderSchema.plugin(stratumPlugin, { watchDeletes: true });

const stream = Order.watch();
stream.on("change", (change) => {
  if (change.operationType === "delete") console.log(change.fullDocumentBeforeChange);
});
stream.on("error", (err) => console.error(err));
```

- The stream always sets `fullDocumentBeforeChange: "required"`. Update and delete events carry the pre-image in `fullDocumentBeforeChange`.
- If the collection has no pre-images, the stream emits an `error` that names `changeStreamPreAndPostImages`, and then closes.
- If a pre-image is not available for an event, the server stops the stream with an error. This occurs for a document written before you enabled pre-images, and for a pre-image that has expired.
- An update event is not delivered if its pre-image belongs to another tenant.
- On a discriminator model, Mongoose adds a filter on `fullDocument` to the stream, so delete events are not delivered.

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
