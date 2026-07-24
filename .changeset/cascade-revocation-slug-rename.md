---
"@stratum-hq/lib": patch
---

Harden CASCADE permission and ABAC policy revocation so it reaches every current descendant identified by stable tenant identity. Descendant matching now uses the ID-based `ancestry_path` instead of the slug-derived subtree key, so a prior slug rename can no longer leave a revoked permission or policy live on a descendant.
