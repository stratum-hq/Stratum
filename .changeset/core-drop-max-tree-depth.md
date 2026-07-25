---
"@stratum-hq/core": major
---

Remove `MAX_TREE_DEPTH` from the `@stratum-hq/core` public surface (#219, from the #133 v1.0 surface review).

No depth limit is enforced anywhere in `@stratum-hq/lib` or `@stratum-hq/core`, so exporting the constant advertised a guarantee that does not exist. It is no longer exported. No enforcement was added. If you imported `MAX_TREE_DEPTH`, drop the import; it was never backed by a runtime check.
