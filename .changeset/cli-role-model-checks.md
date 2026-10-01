---
"@stratum-hq/cli": minor
---

`stratum db roles --apply` runs only as a superuser or as the `--admin-role` login, and the catalog queries of `db`, `doctor`, `health`, `scan`, `migrate` and `generate` are hardened, and `doctor` and `health` warn when the application login can create schemas in the database while the admin login's `search_path` contains `"$user"` (GHSA-mg93-96h7-h9fq).
