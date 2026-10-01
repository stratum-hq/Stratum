---
"@stratum-hq/lib": minor
---

`enforceRls: true` now checks the connecting role every time: `initialize()` (with or without `autoMigrate`), `migrate()` and `migrateAllSchemas()` throw when the role has `BYPASSRLS`. Previously the check ran only inside migration 001, so a database that was already migrated accepted a `BYPASSRLS` role. Upgrade note: a deployment with `enforceRls` on (the control plane turns it on outside development and test) that connects as a `BYPASSRLS` role now refuses to start; connect as a role without `BYPASSRLS`. See GHSA-mg93-96h7-h9fq.
