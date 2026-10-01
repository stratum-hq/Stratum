---
"@stratum-hq/cli": patch
---

`stratum generate api-key` now refuses a `STRATUM_API_KEY_HMAC_SECRET` shorter than 32 bytes outside `development` and `test`, with the same message as `@stratum-hq/lib`, instead of storing a key hash the library would not start with. (GHSA-mg93-96h7-h9fq)
