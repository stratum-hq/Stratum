---
"@stratum-hq/cli": minor
---

`stratum db roles --apply` runs only as a superuser or as the `--admin-role` login, and the catalog queries of `db`, `doctor`, `health`, `scan`, `migrate` and `generate` are hardened (GHSA-mg93-96h7-h9fq).
