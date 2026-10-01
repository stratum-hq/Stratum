---
"@stratum-hq/lib": patch
"@stratum-hq/core": patch
---

`suspendTenant` on a tenant with active children now reports "Cannot suspend tenant ...", not "Cannot archive tenant ...". `TenantHasChildrenError` takes an optional action (`"archive"` by default, or `"suspend"`) that names the blocked transition. (#477)
