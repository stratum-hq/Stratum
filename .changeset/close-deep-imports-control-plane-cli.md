---
"@stratum-hq/control-plane": minor
"@stratum-hq/cli": minor
---

Add an `exports` map to `@stratum-hq/control-plane` and `@stratum-hq/cli` so deep imports no longer resolve (#219, from the #133 v1.0 surface review).

Neither package is a JS import surface: `@stratum-hq/control-plane` is a deployable server whose `index` calls `main()` on import (its 1.0 contract is the HTTP REST API and OpenAPI document), and `@stratum-hq/cli` is a bin whose contract is its command surface. Both now expose only their documented entry (`.`) and block accidental deep imports such as `@stratum-hq/control-plane/dist/routes/...`. The `stratum` bin and `node dist/index.js` startup are unchanged. If you deep-imported internals from either package (never a supported path), import from the package entry instead.
