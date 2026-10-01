---
"@stratum-hq/lib": minor
---

Outside `development` and `test`, `@stratum-hq/lib` now refuses to start when `STRATUM_API_KEY_HMAC_SECRET` is set to fewer than 32 bytes, the same minimum as `STRATUM_ENCRYPTION_KEY`. An unset secret is still accepted and keeps SHA-256 key hashing. A deployment with a shorter secret must set a longer one; existing HMAC-hashed keys then no longer match and must be reissued. (GHSA-mg93-96h7-h9fq)
