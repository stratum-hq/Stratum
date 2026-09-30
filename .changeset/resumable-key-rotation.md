---
"@stratum-hq/lib": minor
---

`rotateEncryptionKey` can now resume after a partial failure.

The rotation commits in batches. Before this change, a run that failed partway could not be repeated: the second run failed on the first value that was already on the new key. Now the run keeps a value that already decrypts with the new key. It also continues past a value that decrypts with neither key.

`KeyRotationResult` has two new fields:

- `already_rotated`: the number of values that already decrypt with the new key.
- `unreadable`: the rows (`table` and `id`) whose value decrypts with neither key. The run leaves them unchanged.

The control plane `POST /api/v1/maintenance/rotate-encryption-key` response includes the same two fields.
