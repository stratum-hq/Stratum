---
"@stratum-hq/cli": minor
---

`stratum doctor` checks `STRATUM_ENCRYPTION_KEY` and `STRATUM_HKDF_SALT` against the rules `@stratum-hq/lib` applies at startup: the key must be set, at least 32 bytes and not the built-in development key, and the salt must be set, hex, and not the built-in development salt. Outside `development` and `test` a broken rule is a failure, because Stratum refuses to start, and doctor exits 1. In `development` and `test` it is a warning. The old message, which said values would not be encrypted at rest, is gone: without a key, development and test use the built-in development key. (GHSA-mg93-96h7-h9fq)
