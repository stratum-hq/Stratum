---
"@stratum-hq/db-adapters": patch
"@stratum-hq/cli": patch
"@stratum-hq/control-plane": patch
---

Every `tenant_isolation` policy that Stratum generates now reads the tenant with `NULLIF(current_setting('app.current_tenant_id', true), '')::uuid`, the same form as the policies in Stratum's own migrations. This applies to `createPolicy` and `createIsolationPolicy` in `@stratum-hq/db-adapters`, to `stratum migrate` and the SQL from `stratum scan --generate`, and to `setupRLSForTable` in the control plane.

On a pooled connection, the setting reads as `''` after the transaction that set it ends. Before, a query on that connection with no tenant context failed with `invalid input syntax for type uuid: ""`. Now the query returns no rows.

Policies that already exist in a database do not change. To update one, drop it and create it again with the new expression.
