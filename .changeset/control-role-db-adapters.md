---
"@stratum-hq/db-adapters": minor
---

Support for the control role of `@stratum-hq/lib` migration 032 (GHSA-mg93-96h7-h9fq).

- `createPolicy` accepts a `stratum_control_plane` policy only when it applies to exactly the control role (`controlRole` option, default `stratum_control`), recognizes the migration 032 legacy form, and emits a `STRATUM_GUC_BYPASS_POLICY` process warning for a policy that checks `app.bypass_rls` directly.
- `withRlsBypass` is deprecated and emits a one-time deprecation warning. It will be removed in 2.0.
- The PGlite guide shows `adminPool` with a restricted application pool.
