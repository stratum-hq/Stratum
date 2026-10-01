---
"@stratum-hq/control-plane": patch
---

The control plane checks the role model at startup also without `DATABASE_ADMIN_URL`, and its migrations refuse a `DATABASE_ADMIN_URL` that logs in as the same role as `DATABASE_URL` (GHSA-mg93-96h7-h9fq).
