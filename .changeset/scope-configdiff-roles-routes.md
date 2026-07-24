---
"@stratum-hq/control-plane": minor
---

Scope the config diff and role administration routes to the caller key's subtree. A tenant-scoped API key may now diff and administer roles only within its own tenant and descendants: the config diff authorizes both compared tenants (query `tenant_a`/`tenant_b`), role create/list authorize the tenant read from the body/query, and the role-by-id and role-assignment routes authorize the target role's and API key's owning tenant. Global operator keys (tenant_id null) keep full access.
