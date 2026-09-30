---
"@stratum-hq/db-adapters": patch
---

`SchemaRawAdapter.executeWithTenantContext` now releases the connection when `ROLLBACK` or `RESET search_path` fails. Before, a failed RESET skipped `client.release()`, so the pool lost the connection. A failed ROLLBACK or RESET also replaced the result or the original error. Now the adapter keeps the result or the original error, and pg-pool removes the connection from the pool instead of reusing it.
