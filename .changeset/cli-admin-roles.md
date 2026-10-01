---
"@stratum-hq/cli": minor
---

Commands for the opt-in role model of `@stratum-hq/lib` migration 032 (GHSA-mg93-96h7-h9fq).

- `--admin-database-url` (or `DATABASE_ADMIN_URL`): `doctor`, `generate api-key` and `migrate --tenant` read and write Stratum's tables as the control role on that login. Without it they fall back to the legacy `app.bypass_rls` path with a warning, and once that path is closed they report that they could not run instead of reading zero rows.
- New `stratum db roles`: prints the `bootstrapRolesSql()` SQL, or applies it with `--apply` (`--admin-role`, `--app-role`, `--control-role`, `--schema`) and reports the resulting role model. It moves only Stratum's own objects, never application tables.
- New `stratum db lock` / `stratum db unlock`: turn the legacy `app.bypass_rls` switch off or on, as a member of the control role.
- `doctor` and `health` report the role model: whether the control role is applied, whether the application login is limited to its share, whether the admin login can act as the control plane, and the legacy switch. `doctor` also reports policies that admit `app.bypass_rls` directly. These are warnings in 1.x.
- `generate api-key` stores an HMAC hash when `STRATUM_API_KEY_HMAC_SECRET` is set, as the library does, so the key authenticates when legacy hashes are refused.
- `--control-role` names the control role for the policy checks of `doctor`, `scan`, `migrate` and `health`.
- `migrate` names the `REFERENCES` grant on `tenants` that its foreign key needs, when the login lacks it.
- The policy checks now share their expression rules with `@stratum-hq/db-adapters`.
