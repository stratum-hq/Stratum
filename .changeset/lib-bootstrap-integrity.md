---
"@stratum-hq/lib": minor
---

Role model follow-ups (GHSA-mg93-96h7-h9fq).

- `bootstrapRolesSql()` first checks that the Stratum tables carry only what the Stratum migrations created (no rules, no triggers, defaults, constraints, indexes or policies that use other functions or operators, no other column types, unchanged Stratum functions) and stops with a list of what it found. `stratum_apply_control_role()` is now one of the Stratum functions it moves to the admin login.
- The application-login check of `initialize()` also reports a login that owns the schema of the Stratum tables (directly or as the database owner) or is a member of the role that owns them.
- New `inspectRoleModel()` returns the role-model checks as data, for logins or named roles, without logging. The CLI's `doctor`, `health` and `db roles` use it.
- `stratum_apply_control_role()` (migration 032, run by the migration and by the bootstrap SQL) now resets row-level security on every Stratum table: it drops all their policies, enables and forces RLS, and re-creates the canonical policies of migrations 019, 020, 031 and 032. Applying it restores policies that an owner of the tables changed, dropped or added.
- New `stratumPolicyDrift()` and `STRATUM_RLS_TABLES`: compare the RLS flags and policies of the Stratum tables with the canonical set.
