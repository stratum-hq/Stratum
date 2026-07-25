---
"@stratum-hq/lib": patch
---

Fix moveTenant leaving the moved node's direct children with a stale
ancestry_path, depth, and ancestry_ltree. The descendant rewrite matched only
paths with a segment after the moved tenant (a `LIKE 'prefix/%'`), so immediate
children — whose ancestry_path equals the prefix exactly — were skipped, leaving
the subtree inconsistent and hiding those children from getDescendants (which
queries the ltree). The rewrite now also matches the exact prefix. Surfaced by a
new real-database integration test; the existing unit tests mock the pool and
never exercised the descendant rows.
