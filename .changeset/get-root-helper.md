---
"@stratum-hq/lib": minor
---

Add `getRoot(id)` to resolve the top-most ancestor (root tenant) for any tenant in the tree, or the tenant itself when it is already a root. Efficient single-row lookups (does not fetch the whole ancestor chain); the primitive for root-org ownership, billing scope, and root-level policy in hierarchical multi-tenancy.
