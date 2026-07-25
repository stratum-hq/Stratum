---
"@stratum-hq/sdk": major
---

Stop exporting the raw `tenantStorage` `AsyncLocalStorage` instance from `@stratum-hq/sdk` (#219, from the #133 v1.0 surface review).

`tenantStorage` leaked an internal store that let consumers reach into request context directly. The intended surface is `getTenantContext`, `runWithTenantContext`, and `setTenantContext`, which remain exported. If you used `tenantStorage` directly, switch to those helpers.
