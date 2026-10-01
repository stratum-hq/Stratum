---
"@stratum-hq/lib": minor
---

Key rotation can now move encrypted data to a new HKDF salt. `rotateEncryptionKey` takes an optional fourth argument, `{ oldSalt, newSalt }`, in the hex format of `STRATUM_HKDF_SALT`. The run decrypts with the old key and the old salt, and encrypts with the new key and the new salt. A salt that is not given is the configured `STRATUM_HKDF_SALT`, so existing calls work as before.

The new `STRATUM_HKDF_SALT_PREVIOUS` variable works together with `STRATUM_ENCRYPTION_KEY_PREVIOUS`. If the current key and salt do not decrypt a value, Stratum tries the previous key with the previous salt. A deployment that moves off the built-in development key can now move to a new random salt. The lib docs give the order of the steps.
