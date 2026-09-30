---
"@stratum-hq/sdk": minor
---

`StratumClient` throws typed errors for more control plane responses. A 400 `VALIDATION_ERROR` becomes a `ValidationError` with the failed fields in `details.issues`. Before, it was a plain `Error` without the issues. Other `details` from the control plane stay in `details` too. A 404 `REGION_NOT_FOUND` becomes a `RegionNotFoundError`. A 409 `REGION_IN_USE` becomes a `RegionInUseError`, and a 409 `REGION_NOT_ACTIVE` becomes a `RegionNotActiveError`.
