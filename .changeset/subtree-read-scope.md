---
"@stratum-hq/lib": minor
"@stratum-hq/db-adapters": minor
"@stratum-hq/cli": minor
---

Add an opt-in subtree read scope to row-level security. A tenant context in the subtree scope reads the rows of its tenant and of every descendant. Writes stay limited to the exact tenant. The default scope does not change.

- `@stratum-hq/lib`: migration 031 adds the function `stratum_subtree_tenant_ids()` and a `tenant_subtree_read` policy, for `SELECT` only, to exactly these tables: `config_entries` (rows with `sensitive = false` only), `permission_policies`, `abac_policies`, `roles`, `principal_roles`, `audit_logs`, `usage_events`, `consent_records`, `webhook_events`, `webhook_deliveries` and `tenants`. Credential-bearing rows stay exact-tenant: `api_keys`, `webhooks` and sensitive `config_entries` rows get no subtree read. `SELECT ... FOR UPDATE` and `FOR SHARE` in the subtree scope return the exact tenant's rows only. The function runs once per policy reference in a statement and its cost grows with the subtree, so each table needs an index on `tenant_id`. Migration 031 also refuses a change to the tree columns of `tenants` (`parent_id`, `ancestry_path`, `depth`, `ancestry_ltree`) unless the session has the RLS bypass, which the library's tree operations use, so a move through `moveTenant` changes the subtree at once and a tenant context cannot move itself. It pins the `search_path` of its functions, and of the parent cycle guard of migration 029, with `pg_temp` last. `runScopedJob` takes `{ scope: "subtree" }`.
- `@stratum-hq/db-adapters`: `setTenantContext` and `withTenantContext` take `{ scope: "exact" | "subtree" }`. `createPolicy` and `createIsolationPolicy` take `{ subtreeRead: true }`. `dropPolicy` also drops `tenant_subtree_read`. The policy check accepts the subtree policy form when the function is unqualified or qualified with the schema of the `tenants` table.
- `@stratum-hq/cli`: the policy check that `doctor`, `scan`, `migrate` and `health` use counts a table with the subtree policy as isolated when the function is unqualified or qualified with `public`, the schema the check reads.
