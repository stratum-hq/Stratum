---
"@stratum-hq/mongodb": patch
---

`stratumPlugin`: `save()` of an existing document now includes the current tenant in its update filter. A save that does not match a document of the current tenant fails with a `DocumentNotFoundError` and changes nothing. (GHSA-mg93-96h7-h9fq)
