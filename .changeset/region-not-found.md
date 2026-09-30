---
"@stratum-hq/core": minor
"@stratum-hq/lib": patch
"@stratum-hq/control-plane": patch
---

A missing region now gives a typed not-found error. Core adds `RegionNotFoundError` with the code `REGION_NOT_FOUND`. The lib region functions throw it, and `migrateRegion` throws `TenantNotFoundError` for a missing tenant. The control plane answers 404 instead of 500 for these requests.
