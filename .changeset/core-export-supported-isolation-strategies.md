---
"@stratum-hq/core": minor
---

Export the canonical `SUPPORTED_ISOLATION_STRATEGIES` constant from `@stratum-hq/core` (#219, from the #133 v1.0 surface review).

Previously only the `@deprecated` `SUPPORTED_ISOLATION_STRATEGIES_V1` alias was reachable from the package entry, so the deprecated spelling would have been the sole public name at 1.0. The canonical `SUPPORTED_ISOLATION_STRATEGIES` is now exported; `SUPPORTED_ISOLATION_STRATEGIES_V1` remains as a deprecated alias for one more minor and will be removed in a future major. Migrate imports to the non-deprecated name.
