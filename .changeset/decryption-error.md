---
"@stratum-hq/lib": patch
"@stratum-hq/core": patch
---

Reading an encrypted value under the wrong `STRATUM_ENCRYPTION_KEY` or `STRATUM_HKDF_SALT` now throws a `DecryptionError` (code `DECRYPTION_FAILED`) that says which settings to check, instead of Node's "Unsupported state or unable to authenticate data". The original error is kept as `cause`. A value that is not in the encrypted format also throws `DecryptionError`, and its message still contains "Invalid encrypted value format". `@stratum-hq/core` exports the new error class and code, and `@stratum-hq/lib` re-exports it. Key material validation at startup is unchanged. (#477)
