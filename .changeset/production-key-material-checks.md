---
"@stratum-hq/lib": minor
---

Stricter key material checks. Outside `development` and `test` (an unset `NODE_ENV` counts as `development`), the library now refuses to load unless `STRATUM_ENCRYPTION_KEY` is set, is at least 32 bytes, and is not the built-in development key, and `STRATUM_HKDF_SALT` is set and is not the built-in development salt. Previously a missing key failed only on the first sensitive operation. In every environment, a `STRATUM_HKDF_SALT` that is set must be a non-empty, even-length hex string; any other value used to become a shorter or empty salt without warning. The legacy `WEBHOOK_ENCRYPTION_KEY` variable is now read only in development and test.

Upgrade note: a deployment whose key is shorter than 32 bytes, or whose salt is not valid hex, now refuses to start. Rotate to a new key and salt with `rotateEncryptionKey`, keeping the old values readable through `STRATUM_ENCRYPTION_KEY_PREVIOUS` and `STRATUM_HKDF_SALT_PREVIOUS`, which are not subject to these checks. As the old salt in hex, give the leading hex pairs of the old value, which are the bytes Node used, or `00` when the old value starts with a character that is not hex (an empty salt and `00` derive the same key). A deployment that set only `WEBHOOK_ENCRYPTION_KEY` must set `STRATUM_ENCRYPTION_KEY` to the same value. See GHSA-mg93-96h7-h9fq.
