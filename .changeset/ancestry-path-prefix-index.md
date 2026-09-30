---
"@stratum-hq/lib": patch
---

Subtree queries now use an index. `getDescendants`, CASCADE permission revocation and CASCADE ABAC policy revocation select descendants by the prefix of the tenant's own `ancestry_path`. Migration `028_ancestry_path_prefix_index.sql` adds the `text_pattern_ops` index that serves this prefix match. Before, each of these calls scanned the whole `tenants` table. The returned rows do not change.

While migration 028 builds the index, PostgreSQL blocks writes to `tenants`. On a large `tenants` table, you can build the index first with `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenant_ancestry_path_prefix ON tenants (ancestry_path text_pattern_ops);`. The migration then finds the index and skips it.

CASCADE permission revocation and ABAC policy revocation now throw `TenantNotFoundError` when the tenant is removed while the revocation runs. Before, they threw a `TypeError`.
