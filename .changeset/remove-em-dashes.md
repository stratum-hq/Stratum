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
"@stratum-hq/test-utils": patch
---

Replace em dashes in user-visible text with ordinary punctuation. This touches READMEs, package descriptions, CLI output, control plane startup log messages, the text that `@stratum-hq/create` writes into generated projects, and the assertion messages in `@stratum-hq/test-utils`. The CLI `health` and `migrate` tables now print `no` instead of a dash for an unset flag. No behavior changes.
