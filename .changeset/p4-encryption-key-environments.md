---
"@stratum-hq/lib": minor
---

`STRATUM_ENCRYPTION_KEY` and `STRATUM_HKDF_SALT` are now required in every environment other than `development` and `test` (an unset `NODE_ENV` counts as `development`); only those fall back to the built-in key (GHSA-jx2p-pffr-c5gh).

Upgrade note: deployments outside development and test must set `STRATUM_ENCRYPTION_KEY` and `STRATUM_HKDF_SALT`. Data encrypted without them used the built-in development key and must be re-encrypted with `rotateEncryptionKey` while the built-in salt is still in effect: set `STRATUM_HKDF_SALT` to the built-in salt's hex value, then rotate. See "Moving off the built-in development key" in the `@stratum-hq/lib` package docs (`website/src/content/docs/packages/lib.mdx`).
