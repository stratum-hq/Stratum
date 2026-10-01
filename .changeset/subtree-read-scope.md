---
"@stratum-hq/lib": minor
"@stratum-hq/db-adapters": minor
"@stratum-hq/cli": minor
---

Add an opt-in subtree read scope to row-level security. A tenant context in the subtree scope reads the rows of its tenant and of every descendant. Writes stay limited to the exact tenant. The default scope does not change.

- `@stratum-hq/lib`: migration 031 adds the function `stratum_subtree_tenant_ids()` and a `tenant_subtree_read` policy, for `SELECT` only, to these tables: `config_entries`, `permission_policies`, `abac_policies`, `roles`, `principal_roles`, `audit_logs`, `usage_events`, `consent_records`, `webhooks`, `webhook_events`, `webhook_deliveries` and `tenants`. `api_keys` does not get it: an API key row holds credential material, even though the key is hashed, so only the exact tenant reads it. `runScopedJob` takes `{ scope: "subtree" }`.
- `@stratum-hq/db-adapters`: `setTenantContext` and `withTenantContext` take `{ scope: "exact" | "subtree" }`. `createPolicy` and `createIsolationPolicy` take `{ subtreeRead: true }`. `dropPolicy` also drops `tenant_subtree_read`. The policy check accepts the subtree policy form.
- `@stratum-hq/cli`: the policy check that `doctor`, `scan`, `migrate` and `health` use counts a table with the subtree policy as isolated.
