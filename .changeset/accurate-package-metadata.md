---
"@stratum-hq/lib": patch
"@stratum-hq/react": patch
"@stratum-hq/core": patch
"@stratum-hq/cli": patch
"@stratum-hq/control-plane": patch
"@stratum-hq/create": patch
"@stratum-hq/db-adapters": patch
"@stratum-hq/sdk": patch
"@stratum-hq/mysql": patch
"@stratum-hq/mongodb": patch
"@stratum-hq/nestjs": patch
"@stratum-hq/hono": patch
"@stratum-hq/test-utils": patch
"@stratum-hq/stratum": patch
---

Correct and complete package metadata for the npm registry listing.

Every published package now declares `license` (MIT), `author`, `homepage`, and
`bugs`. Runtime packages declare `engines` (Node >=20) to match the project's
support policy; this fixes `@stratum-hq/cli`, which previously declared Node >=18.
`@stratum-hq/mysql` and `@stratum-hq/mongodb` gain the `keywords` array they were
missing. No runtime code changes.
