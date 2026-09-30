---
"@stratum-hq/lib": minor
---

`validateApiKey` now updates `last_used_at` only when the stored value is more than 60 seconds old, and waits at most one second for that update. Concurrent requests with one key no longer wait on its row lock, and a blocked update no longer delays authentication. `last_used_at` can now lag the latest use by up to one minute. `listDormantKeys` counts in days, so its results do not change. A legacy-hash upgrade still runs on the first validation after an HMAC secret is set.

`activateTenant` now reads the tenant again when the database call fails with an error that is not a Stratum error, such as a dropped connection. If the tenant is `active`, the activation committed: the call succeeds and emits `tenant.activated` once. Before, the call failed and no event was emitted.
