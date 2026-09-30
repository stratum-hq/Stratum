---
"@stratum-hq/control-plane": patch
"@stratum-hq/core": minor
---

`POST /api/v1/tenants` now removes the schema or database it provisioned when activation of the new tenant fails. Before this change, the storage stayed behind, and purging the pending tenant did not remove it. The tenant stays `pending`, and the response is `TENANT_PROVISIONING_FAILED` with `details.stage` set to `"activation"`. If the removal also fails, `details.storage_removed` is `false`, and an operator must drop the storage by hand. If the activation reports an error but the tenant is `active`, the route returns the active tenant and keeps its storage.

`TenantProvisioningError` has a new optional second argument that names the failed stage. Its `details` now include `stage` (`"provisioning"` or `"activation"`), and `storage_removed` for the activation stage.
