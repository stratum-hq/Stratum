---
"@stratum-hq/core": minor
"@stratum-hq/lib": patch
"@stratum-hq/control-plane": patch
---

Region conflicts now throw typed errors instead of a plain `Error`:

- `deleteRegion` throws `RegionInUseError` (code `REGION_IN_USE`, HTTP 409) when active tenants are still assigned to the region.
- `migrateRegion` throws `RegionNotActiveError` (code `REGION_NOT_ACTIVE`, HTTP 409) when the target region is not `active`.

The control plane now answers `409` with these codes for `DELETE /api/v1/regions/:id` and `POST /api/v1/tenants/:id/migrate-region`. Before, it answered `500 INTERNAL_SERVER_ERROR`. The error messages do not change.
