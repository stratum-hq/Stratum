---
"@stratum-hq/lib": patch
---

`validateApiKey` now waits for its `last_used_at` update, and for the legacy-hash upgrade, before it resolves. Before, the update ran in the background, so a `listDormantKeys` call made right after a validation could still report the key as dormant. The update still runs after the validation connection is released, so a pool with one connection still works. A failed update still does not fail authentication. Each successful validation now waits for one extra `UPDATE` round trip.
