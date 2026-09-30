---
"@stratum-hq/cli": minor
---

`stratum migrate <table>` now works on a table that already has rows. Before, the migration always rolled back on such a table, because it gave every existing row a placeholder tenant that the foreign key to `tenants` rejects.

The new `--tenant <uuid>` flag assigns every existing row to that tenant. The flag is required when the table has rows; without it, the migration stops and changes nothing. The tenant must exist in the `tenants` table, and the nil UUID is rejected.
