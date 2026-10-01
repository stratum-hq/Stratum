---
"@stratum-hq/lib": minor
---

Opt-in hardening of the control-plane path (GHSA-mg93-96h7-h9fq).

- New migration 032 adds a NOLOGIN control role (`stratum_control` by default, configurable per database through `controlRole` or the `stratum.control_role` setting) with a `stratum_control_plane` policy on every Stratum table. The SECURITY DEFINER helpers are owned by that role and no longer set `app.bypass_rls`. A fresh install no longer needs a superuser: a migrating role with CREATEROLE is enough, and without it the migration prints the bootstrap SQL.
- `regions` now has row-level security like the other Stratum tables.
- `new Stratum({ adminPool, pool })`: the library runs its own queries and `autoMigrate` on `adminPool`, a login that is a member of the control role, and `initialize()` checks both logins against the recommended role model (warns; throws for the application login with `enforceRls`). `adminPool` is optional in 1.x, with a one-time deprecation warning when absent.
- New exports: `STRATUM_CONTROL_ROLE`, `bootstrapRolesSql()`, `APP_READ_TABLES`.
- The legacy `app.bypass_rls` path stays available behind the `stratum_security.legacy_guc_bypass` switch, on by default in 1.8. Turn it off once every client uses `adminPool`.
- Once `STRATUM_API_KEY_HMAC_SECRET` is set, API keys with a legacy SHA-256 hash are no longer accepted. Set `allowLegacyKeyHashes: true` for a transition window to re-hash them on use, then rotate the rest.

2.0 will require `adminPool` and remove the legacy switch.
