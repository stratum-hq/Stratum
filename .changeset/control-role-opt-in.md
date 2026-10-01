---
"@stratum-hq/lib": minor
---

Migration 032 grants the control role to the migrating login only with `migrate({ applyControlRole: true })` (set by `autoMigrate` with `adminPool`), or when that login is a superuser or already a member, and the control-role functions and bootstrap SQL are hardened. See GHSA-mg93-96h7-h9fq.
