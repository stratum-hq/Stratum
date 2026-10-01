---
"@stratum-hq/lib": patch
"@stratum-hq/core": patch
"@stratum-hq/control-plane": patch
"@stratum-hq/sdk": patch
"@stratum-hq/cli": patch
"@stratum-hq/create": patch
"@stratum-hq/compliance": patch
"@stratum-hq/db-adapters": patch
"@stratum-hq/hono": patch
"@stratum-hq/mongodb": patch
"@stratum-hq/mysql": patch
"@stratum-hq/nestjs": patch
"@stratum-hq/react": patch
"@stratum-hq/stratum": patch
"@stratum-hq/test-utils": patch
---

Improve the npm metadata so that npm search finds the packages. Each `description` now starts with the problem the package solves. Each package carries the same multi-tenancy keywords, including `multitenancy`. The `homepage` field now points at the package's page on https://docs.stratum-hq.org instead of a GitHub folder. The first lines of each README link the documentation. No code changes.
