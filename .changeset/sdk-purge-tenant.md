---
"@stratum-hq/sdk": minor
---

Add `StratumClient.purgeTenant(id)`, which calls `POST /api/v1/tenants/:id/purge` to permanently delete a tenant and its data. Deprecate `deleteTenant(id)`: it sends the same soft-delete request as `archiveTenant(id)` and does not remove data.
