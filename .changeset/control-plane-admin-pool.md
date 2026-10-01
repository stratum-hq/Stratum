---
"@stratum-hq/control-plane": minor
---

Optional admin login for the opt-in role model of `@stratum-hq/lib` migration 032 (GHSA-mg93-96h7-h9fq).

- `DATABASE_ADMIN_URL`: when set, the migrations, the library (as `adminPool`) and tenant schema and database provisioning run on the admin login, both logins are checked against the role model at startup, and `/api/v1/health` reports `admin_db`. When unset, the control plane behaves as before.
- `STRATUM_CONTROL_ROLE` names the control role, and `STRATUM_ALLOW_LEGACY_KEY_HASHES` (`true` or `false`) sets the library's `allowLegacyKeyHashes`.
