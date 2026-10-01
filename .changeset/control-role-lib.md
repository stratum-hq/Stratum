---
"@stratum-hq/lib": minor
---

Opt-in hardening of the control-plane path (GHSA-mg93-96h7-h9fq).

- New migration 032 adds a NOLOGIN control role (`stratum_control` by default, configurable per database through `controlRole` or the `stratum.control_role` setting) with a `stratum_control_plane` policy on every Stratum table. The SECURITY DEFINER helpers are owned by that role and no longer set `app.bypass_rls`.
- 032 never stops an upgrade: when the migrating role can neither create nor join the control role, it applies the rest, skips the control role with a warning that prints the bootstrap SQL, and the database keeps its previous behavior. `initialize()` reports the hardening as not active until an administrator runs that SQL, which calls the new idempotent `stratum_apply_control_role()` function.
- A fresh install no longer needs a superuser. For a migrating role that is not a superuser, `migrate()` drops the `SET app.*` clause lines of the migration 029 and 031 helper functions, which PostgreSQL accepts only from a superuser; 032 re-creates both functions without them.
- `regions` now has row-level security like the other Stratum tables.
- `new Stratum({ adminPool, pool })`: the library runs its own queries and `autoMigrate` on `adminPool`, a login that is a member of the control role, and `initialize()` checks both logins against the recommended role model (warns; throws for the application login with `enforceRls`). `adminPool` is optional in 1.x, with a one-time deprecation warning when absent.
- New exports: `STRATUM_CONTROL_ROLE`, `bootstrapRolesSql()`, `APP_READ_TABLES`.
- The legacy `app.bypass_rls` path stays available behind the `stratum_security.legacy_guc_bypass` switch, on by default in 1.8. Turn it off once every client uses `adminPool`.
- New option `allowLegacyKeyHashes` (default true in 1.x). While `STRATUM_API_KEY_HMAC_SECRET` is set, API keys with a legacy SHA-256 hash still authenticate and are re-hashed with HMAC on use, with a one-time warning. Set it to false to accept only HMAC hashes.

2.0 will require `adminPool`, remove the legacy switch, and default `allowLegacyKeyHashes` to false.
