---
"@stratum-hq/mongodb": minor
---

Tighten tenant scoping (GHSA-fxg8-jqvx-hpc5). Behavior changes: stratumPlugin replaces Model.watch() with a tenant-filtered change stream that drops delete, drop, rename and invalidate events and throws without a tenant context, and refuses a schema that already defines watch(); aggregate cursors run the pipeline as checked; MongoCollectionAdapter.scopedCollection throws without baseCollections.
