---
"@stratum-hq/cli": patch
"@stratum-hq/control-plane": patch
"@stratum-hq/db-adapters": patch
"@stratum-hq/hono": patch
"@stratum-hq/lib": patch
"@stratum-hq/mongodb": patch
"@stratum-hq/mysql": patch
"@stratum-hq/nestjs": patch
"@stratum-hq/react": patch
"@stratum-hq/sdk": patch
---

Declare sibling `@stratum-hq/*` dependencies with caret ranges instead of `"*"` or `>=`. An install now gets a sibling version that has the API the package calls, and never a future major version.
