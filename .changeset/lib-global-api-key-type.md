---
"@stratum-hq/lib": patch
---

`createApiKey()` accepts `null` as the tenant ID, to create a global key. The runtime already stored a global key with `tenant_id` null; the type rejected the call.
