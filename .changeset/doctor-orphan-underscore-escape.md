---
"@stratum-hq/cli": patch
---

Fix the table scan so it can report orphan tables again.

The internal-table filter in `scanTables` used `NOT LIKE '\_%'` inside a JavaScript template literal. JavaScript drops the backslash from the unrecognized `\_` escape, so Postgres received `NOT LIKE '_%'`, where a bare `_` is the single-character wildcard. That predicate is false for every non-empty table name, so the scan excluded all tables and `stratum scan`, `stratum migrate`, and `stratum doctor` never surfaced a table needing tenant isolation.

The escape is now doubled (`NOT LIKE '\\_%'`) so Postgres receives a literal `\_%`. Genuine orphan tables are reported again, while only tables whose name starts with a literal underscore (internal tables) are skipped.
