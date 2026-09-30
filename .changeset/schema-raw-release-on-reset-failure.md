---
"@stratum-hq/db-adapters": patch
---

`SchemaRawAdapter.executeWithTenantContext` now releases the connection when `RESET search_path` fails. Before, the failed RESET skipped `client.release()`, so the pool lost the connection, and the RESET error replaced the result or the original error. Now the adapter keeps the result or the original error, and pg-pool removes the connection from the pool instead of reusing it.
