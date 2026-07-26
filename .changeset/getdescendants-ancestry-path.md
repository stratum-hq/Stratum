---
"@stratum-hq/lib": patch
---

fix: scope getDescendants by stable tenant id, not the slug-derived ltree

`getDescendants` matched a tenant's subtree with `ancestry_ltree <@ ...`, where
`ancestry_ltree` is a slug-derived materialized path maintained by a trigger.
Renaming a tenant's slug recomputes only that node's label, so the subtree match
against a renamed node could drop descendants that still carry the old label,
silently under-including the subtree.

The query now matches descendants on the stable, ID-based `ancestry_path` (the
tenant's id appears as a path segment of every descendant), the same approach
already used for permission and ABAC cascade revocation (#115). The `status =
'active'` default and the `includeArchived` opt-in are unchanged. Fixes #189.
