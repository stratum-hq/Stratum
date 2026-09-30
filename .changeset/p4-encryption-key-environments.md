---
"@stratum-hq/lib": minor
---

`STRATUM_ENCRYPTION_KEY` and `STRATUM_HKDF_SALT` are now required in every environment other than `development` and `test` (an unset `NODE_ENV` counts as `development`); only those fall back to the built-in key (GHSA-jx2p-pffr-c5gh).
