---
"@stratum-hq/control-plane": patch
---

A tenant-scoped API key can now purge a pending child tenant in its own subtree, for example after storage provisioning fails. Before, only an operator key could remove it. `DELETE /api/v1/tenants/:id` on such a tenant now returns the tenant state error (409) instead of 403. Archived and suspended tenants are still refused by the scope check.
