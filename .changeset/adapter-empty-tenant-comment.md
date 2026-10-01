---
"@stratum-hq/db-adapters": patch
---

Correct the doc comments of the Sequelize and Drizzle tenant-scope wrappers: with an empty tenant ID they throw, they do not forward the query unwrapped. Behavior is unchanged. (#477)
