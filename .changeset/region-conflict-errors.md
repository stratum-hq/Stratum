---
"@stratum-hq/core": minor
"@stratum-hq/lib": minor
"@stratum-hq/control-plane": patch
---

Region conflicts now throw typed errors instead of a plain `Error`:

- `deleteRegion` throws `RegionInUseError` (code `REGION_IN_USE`, status code 409) when active tenants are still assigned to the region.
- `migrateRegion` throws `RegionNotActiveError` (code `REGION_NOT_ACTIVE`, status code 409) when the target region is not `active`.

`@stratum-hq/lib` now exports `RegionInUseError` and `RegionNotActiveError`. The thrown class changes from `Error` to these `StratumError` subclasses, so a caller can check the class or the `code`. The error messages do not change.

The control plane now answers `409` with these codes for `DELETE /api/v1/regions/:id` and `POST /api/v1/tenants/:id/migrate-region`. Before, it answered `500 INTERNAL_SERVER_ERROR`.
