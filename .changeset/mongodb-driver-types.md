---
"@stratum-hq/mongodb": patch
---

A `MongoClient` of the mongodb driver is assignable to `MongoClientLike`, so the adapters accept it without `as unknown as MongoClientLike`. `CollectionLike.bulkWrite()` takes a readonly array, `CollectionLike.createIndex()` takes a `Record<string, MongoIndexDirection>`, and `DatabaseLike.dropDatabase()` resolves to `unknown`.
