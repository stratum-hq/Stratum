---
"@stratum-hq/lib": patch
---

Harden principal-agnostic role assignment with optional tenant scoping. `assignRole` and `resolvePrincipalScopes` now accept an optional `tenantId`: when supplied, a role owned by a different tenant is refused on assign and ignored on resolve (global roles, tenant_id IS NULL, are always allowed). Prevents cross-tenant role assignment/resolution when the caller opts in. Backward compatible (tenantId is optional).
