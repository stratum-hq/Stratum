---
"@stratum-hq/lib": patch
---

Subtree queries now use an index. `getDescendants`, CASCADE permission revocation and CASCADE ABAC policy revocation select descendants by the prefix of the tenant's own `ancestry_path`. Migration `028_ancestry_path_prefix_index.sql` adds the `text_pattern_ops` index that serves this prefix match. Before, each of these calls scanned the whole `tenants` table. The returned rows do not change.
