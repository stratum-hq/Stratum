---
"@stratum-hq/mongodb": minor
---

Tighten tenant scoping (GHSA-fxg8-jqvx-hpc5): stratumPlugin scopes Model.watch() to the current tenant, checked aggregate pipelines can no longer be edited before they run, and MongoCollectionAdapter.scopedCollection requires baseCollections.
