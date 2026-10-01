---
"@stratum-hq/lib": minor
"@stratum-hq/core": patch
---

`batchSetConfig` is now atomic, as the config inheritance guide documents. Every entry is checked before anything is written. If any key is locked by an active ancestor or is invalid (an empty key, or a value that cannot be stored as JSON), nothing is written and the result has `rolled_back: true`, `succeeded: 0`, and `failed` equal to the number of entries. Every result then has status `error`: the keys that caused the rollback carry their own reason, and the others say they were not applied and name those keys. Previously the unlocked keys of a batch were written and only the locked ones failed. `BatchSetConfigResult` in `@stratum-hq/core` gains the optional `rolled_back` field. (#471)
