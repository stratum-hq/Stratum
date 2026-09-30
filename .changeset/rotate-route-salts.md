---
"@stratum-hq/control-plane": minor
"@stratum-hq/lib": patch
---

The control plane route `POST /api/v1/maintenance/rotate-encryption-key` accepts optional `old_salt` and `new_salt` in hex, and passes them to `rotateEncryptionKey`. A control plane operator can now move encrypted data to a new HKDF salt. The route accepts the same key as `old_key` and `new_key` when the two salts differ. It answers `400 VALIDATION_ERROR` when a salt is not a non-empty, even-length hex string.

`rotateEncryptionKey` in `@stratum-hq/lib` now throws a `ValidationError` for an `oldSalt` or `newSalt` that is not a non-empty, even-length hex string, and changes no row. Before, the hex decoder shortened such a salt without an error, and an empty salt fell back to the configured salt.
