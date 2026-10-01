---
"@stratum-hq/control-plane": patch
---

With `DATABASE_ADMIN_URL`, migrations run with the control-role opt-in, so migration 032 may grant the control role to the admin login (GHSA-mg93-96h7-h9fq).
