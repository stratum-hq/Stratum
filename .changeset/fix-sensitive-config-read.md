---
"@stratum-hq/lib": patch
---

Fix reading back a sensitive (encrypted) config value.

`resolveConfig` and `getConfigWithInheritance` parsed the pg-decoded JSONB value a
second time before decrypting it. The pg driver already parses the JSONB column, so
the extra `JSON.parse` ran against an already-decoded string and threw, meaning any
config key written with `sensitive: true` could not be read back. The same redundant
parse in `rotateEncryptionKey` broke rotating a sensitive config row. Removing the
redundant parse lets sensitive values decrypt and round-trip correctly, including
across a key rotation.
