---
"@stratum-hq/lib": patch
---

`withClient` and `withTransaction` now rethrow the original error when the ROLLBACK also fails. Before, the ROLLBACK error replaced it, so a caller that checks an error code such as `23505` saw the wrong error. When the ROLLBACK fails, the connection is now removed from the pool instead of reused.
