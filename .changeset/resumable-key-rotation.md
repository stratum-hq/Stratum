---
"@stratum-hq/lib": minor
"@stratum-hq/control-plane": patch
---

`rotateEncryptionKey` can now resume after a partial failure.

The rotation commits in batches. Before this change, a run that failed partway could not be repeated: the second run failed on the first value that was already on the new key. Now the run keeps a value that already decrypts with the new key. It also continues past a value that decrypts with neither key.

`KeyRotationResult` has two new fields:

- `already_rotated`: the number of values that already decrypt with the new key.
- `unreadable`: the rows (`table` and `id`) whose value decrypts with neither key. The run leaves them unchanged.

`config_entries_rotated` and `webhooks_rotated` now count only the values that this run re-encrypted. A value that was already on the new key counts in `already_rotated`, not in these two fields.

A rotation with the wrong old key still fails, so the new tolerance for unreadable rows cannot hide a wrong key. If encrypted values exist and none of them decrypts with the old key or the new key, `rotateEncryptionKey` throws a `ValidationError` and changes no row. When some rows decrypt and some do not, the run completes and logs the warning `encryption key rotation left unreadable rows` with the count and the rows.

The control plane `POST /api/v1/maintenance/rotate-encryption-key` response now has these fields: `config_entries_rotated`, `webhooks_rotated`, `already_rotated`, and `unreadable`. The OpenAPI spec documented a `re_encrypted_count` field, which the endpoint never returned; the spec now shows the real response. The endpoint returns `400 VALIDATION_ERROR` when encrypted values exist and none of them decrypts with either key.
