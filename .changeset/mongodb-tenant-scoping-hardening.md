---
"@stratum-hq/mongodb": patch
"@stratum-hq/test-utils": patch
---

Harden MongoDB tenant scoping in the shared-collection proxy and Mongoose plugin, and make `assertMongoIsolation` run through the adapter under test (GHSA-699c-qcjr-hw36).
