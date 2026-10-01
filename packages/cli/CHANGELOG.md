# @stratum-hq/cli

## 0.10.0

### Minor Changes

- 99437c5: Commands for the opt-in role model of `@stratum-hq/lib` migration 032 (GHSA-mg93-96h7-h9fq).

  - `--admin-database-url` (or `DATABASE_ADMIN_URL`): `doctor`, `generate api-key` and `migrate --tenant` read and write Stratum's tables as the control role on that login. Without it they fall back to the legacy `app.bypass_rls` path with a warning, and once that path is closed they report that they could not run instead of reading zero rows.
  - New `stratum db roles`: prints the `bootstrapRolesSql()` SQL, or applies it with `--apply` (`--admin-role`, `--app-role`, `--control-role`, `--schema`) and reports the resulting role model. It moves only Stratum's own objects, never application tables.
  - New `stratum db lock` / `stratum db unlock`: turn the legacy `app.bypass_rls` switch off or on, as a member of the control role.
  - `doctor` and `health` report the role model: whether the control role is applied, whether the application login is limited to its share, whether the admin login can act as the control plane, and the legacy switch. `doctor` also reports policies that admit `app.bypass_rls` directly. These are warnings in 1.x.
  - `generate api-key` stores an HMAC hash when `STRATUM_API_KEY_HMAC_SECRET` is set, as the library does, so the key authenticates when legacy hashes are refused.
  - `--control-role` names the control role for the policy checks of `doctor`, `scan`, `migrate` and `health`.
  - `migrate` names the `REFERENCES` grant on `tenants` that its foreign key needs, when the login lacks it.
  - The policy checks now share their expression rules with `@stratum-hq/db-adapters`.
  - `doctor` reports how the RLS flags and policies of the Stratum tables differ from the canonical set ("Stratum policies"; a warning in 1.x).
  - `db roles --grant-references` also grants the application login `REFERENCES (id)` on `tenants`, for foreign keys from its own tables (opt-in).

- 99437c5: CLI exit codes, `scan --generate` output, `.env.stratum` contents and prompt behavior (#474).

  - `stratum health` now exits with code 1 when a check fails (a missing extension, a login with `BYPASSRLS`, PostgreSQL older than 14), as `stratum doctor` does. Warnings keep exit code 0. Scripts that ran `health` and ignored failures will now see a non-zero exit.
  - `stratum scan --generate` writes only SQL to stdout and the report to stderr, so `stratum scan --generate > migration.sql` produces a file that runs. The SQL adds the foreign key to `tenants(id)` only when that table exists.
  - `.env.stratum` from `stratum init` and `stratum scaffold env` now includes `DATABASE_ADMIN_URL` and random development values for `STRATUM_ENCRYPTION_KEY`, `STRATUM_HKDF_SALT` and `STRATUM_API_KEY_HMAC_SECRET`, with the rules that apply outside development.
  - `stratum scaffold docker` sets up the role model: a NOLOGIN `stratum_control` role, a non-superuser `stratum_admin` login that runs the migrations, and a `stratum_app` login without privileges on the Stratum tables, matching `docker/init-db.sql`. The compose file passes `DATABASE_ADMIN_URL` to the control plane.
  - `stratum migrate` exits with code 1 when stdin closes at a prompt instead of exiting 0 silently. Piped answers are read in full. `stratum init` offers a default for every question, which Enter accepts.
  - `stratum migrate --scan` suggests `stratum migrate <table>` only for tables that command accepts. `stratum migrate` now rejects table names that are not lowercase, which it could not migrate before either.
  - `NO_COLOR` turns off colors.
  - A long flag no longer takes a following short flag as its value (`scan --generate -d <url>`), and an error without a message prints its code.

- 99437c5: `stratum init` and `stratum scaffold nextjs` write the Next.js middleware and the `app/api/stratum` proxy route next to the project's app directory: into `src/` when the project keeps its app in `src/app` (or `src/pages`) and has no root `app/` or `pages/`. Previously they were always written to the output root, where Next.js does not run the middleware for a `src/app` project, and a root `app/` directory would take precedence over `src/app`. See GHSA-mg93-96h7-h9fq.
- 99437c5: `stratum db roles --apply` runs only as a superuser or as the `--admin-role` login, and the catalog queries of `db`, `doctor`, `health`, `scan`, `migrate` and `generate` are hardened; `doctor` and `health` warn when the application login can create schemas in the database while the admin login's `search_path` contains `"$user"` (GHSA-mg93-96h7-h9fq).
- 99437c5: Control role (GHSA-mg93-96h7-h9fq): `stratum db lock` refuses while the application login (the login of `--database-url` when an admin connection is given, or `--app-role`) is a member of the control role. `doctor` and `health` list the members of the control role and warn about members other than the admin login. `stratum scaffold docker` gives the application login its own schema instead of `CREATE` on `public`.
- 99437c5: `stratum doctor` checks `STRATUM_ENCRYPTION_KEY` and `STRATUM_HKDF_SALT` against the rules `@stratum-hq/lib` applies at startup: the key must be set, at least 32 bytes and not the built-in development key, and the salt must be set, hex, and not the built-in development salt. Outside `development` and `test` a broken rule is a failure, because Stratum refuses to start, and doctor exits 1. In `development` and `test` it is a warning. The old message, which said values would not be encrypted at rest, is gone: without a key, development and test use the built-in development key. (GHSA-mg93-96h7-h9fq)

### Patch Changes

- 99437c5: `stratum generate api-key` now refuses a `STRATUM_API_KEY_HMAC_SECRET` shorter than 32 bytes outside `development` and `test`, with the same message as `@stratum-hq/lib`, instead of storing a key hash the library would not start with. (GHSA-mg93-96h7-h9fq)
- 99437c5: `stratum playground` warns again when it falls back to the default database URL, and names the URL it uses (without the password). The check compared against an old default, so the warning never appeared. (#476)
- 99437c5: The policy checks of `doctor` and `scan` recognize the policies of `@stratum-hq/lib` migration 032: the legacy form of `tenant_isolation`, and a `stratum_control_plane` policy that applies to exactly the control role (from the `stratum.control_role` setting of the connection, default `stratum_control`). `doctor` reports whether the control-role hardening is active.
- Updated dependencies [99437c5]
- Updated dependencies [99437c5]
- Updated dependencies [99437c5]
- Updated dependencies [99437c5]
- Updated dependencies [99437c5]
- Updated dependencies [99437c5]
- Updated dependencies [99437c5]
- Updated dependencies [99437c5]
- Updated dependencies [99437c5]
- Updated dependencies [99437c5]
- Updated dependencies [99437c5]
- Updated dependencies [99437c5]
- Updated dependencies [99437c5]
- Updated dependencies [99437c5]
- Updated dependencies [e1b2249]
- Updated dependencies [99437c5]
- Updated dependencies [99437c5]
- Updated dependencies [99437c5]
- Updated dependencies [99437c5]
  - @stratum-hq/db-adapters@1.5.0
  - @stratum-hq/lib@1.8.0
  - @stratum-hq/core@1.6.0

## 0.9.0

### Minor Changes

- 0c2ef75: `stratum doctor` reports tree depth as an advisory. Stratum accepts a tenant tree of any depth, so the check no longer fails above depth 20 and no longer calls 20 a limit. It reports the maximum depth, and warns when that depth is more than a threshold. The default threshold is 20. To change it, use `--depth-warning <n>` or the `STRATUM_DOCTOR_DEPTH_WARNING` environment variable. A deep tree alone no longer makes `doctor` exit with code 1.
- 0c2ef75: Add an opt-in subtree read scope to row-level security. A tenant context in the subtree scope reads the rows of its tenant and of every descendant. Writes stay limited to the exact tenant. The default scope does not change.

  - `@stratum-hq/lib`: migration 031 adds the function `stratum_subtree_tenant_ids()` and a `tenant_subtree_read` policy, for `SELECT` only, to exactly these tables: `config_entries` (rows with `sensitive = false` only), `permission_policies`, `abac_policies`, `roles`, `principal_roles`, `audit_logs`, `usage_events`, `consent_records`, `webhook_events`, `webhook_deliveries` and `tenants`. Credential-bearing rows stay exact-tenant: `api_keys`, `webhooks` and sensitive `config_entries` rows get no subtree read. `SELECT ... FOR UPDATE` and `FOR SHARE` in the subtree scope return the exact tenant's rows only. The function runs once per policy reference in a statement and its cost grows with the subtree, so each table needs an index on `tenant_id`. Migration 031 also refuses a change to the tree columns of `tenants` (`parent_id`, `ancestry_path`, `depth`, `ancestry_ltree`) unless the session has the RLS bypass, which the library's tree operations use, so a move through `moveTenant` changes the subtree at once and a tenant context cannot move itself. It pins the `search_path` of its functions, and of the parent cycle guard of migration 029, with `pg_temp` last. `runScopedJob` takes `{ scope: "subtree" }`.
  - `@stratum-hq/db-adapters`: `setTenantContext` and `withTenantContext` take `{ scope: "exact" | "subtree" }`. `createPolicy` and `createIsolationPolicy` take `{ subtreeRead: true }`. `dropPolicy` also drops `tenant_subtree_read`. The policy check accepts the subtree policy form when the function is unqualified or qualified with the schema of the `tenants` table.
  - `@stratum-hq/cli`: the policy check that `doctor`, `scan`, `migrate` and `health` use counts a table with the subtree policy as isolated when the function is unqualified or qualified with `public`, the schema the check reads.

### Patch Changes

- b737034: Improve the npm metadata so that npm search finds the packages. Each `description` now starts with the problem the package solves. Each package carries the same multi-tenancy keywords, including `multitenancy`. The `homepage` field now points at the package's page on https://docs.stratum-hq.org instead of a GitHub folder. The first lines of each README link the documentation. No code changes.
- a1bd9aa: Replace em dashes in user-visible text with ordinary punctuation. This touches READMEs, package descriptions, CLI output, control plane startup log messages, the text that `@stratum-hq/create` writes into generated projects, and the assertion messages in `@stratum-hq/test-utils`. The CLI `health` and `migrate` tables now print `no` instead of a dash for an unset flag. No behavior changes.
- Updated dependencies [b737034]
- Updated dependencies [a1bd9aa]
- Updated dependencies [0c2ef75]
  - @stratum-hq/lib@1.7.0
  - @stratum-hq/core@1.5.1

## 0.8.0

### Minor Changes

- 508c6b8: `stratum doctor` now finds tenant parent cycles that are already in the data. Migration 029 refuses a write that makes a cycle, but it does not repair a cycle that an earlier write left behind. The new check lists the tenants of each cycle and makes `doctor` exit with code 1. It links to the repair steps in the CLI docs. The repair is one SQL transaction: set `parent_id` of one tenant in the cycle to a tenant outside the cycle, or to `NULL`, then recompute `ancestry_path` and `depth` for the tree. `moveTenant` is not a safe repair for a cycle, because it starts from a stored path that the cycle can make wrong. The CLI docs now also list every `doctor` check.

### Patch Changes

- Updated dependencies [508c6b8]
- Updated dependencies [508c6b8]
  - @stratum-hq/lib@1.6.0

## 0.7.0

### Minor Changes

- 4c1686a: Isolation checks now verify what RLS policies filter on, and the Next.js templates take the tenant from a verified JWT (GHSA-p4wg-j8hh-9wh8).

### Patch Changes

- Updated dependencies [4c1686a]
- Updated dependencies [4c1686a]
- Updated dependencies [4c1686a]
- Updated dependencies [4c1686a]
- Updated dependencies [4c1686a]
- Updated dependencies [4c1686a]
- Updated dependencies [4c1686a]
  - @stratum-hq/lib@1.5.0
  - @stratum-hq/core@1.5.0

## 0.6.0

### Minor Changes

- b47f84f: `stratum migrate <table>` now works on a table that already has rows. Before, the migration always rolled back on such a table, because it gave every existing row a placeholder tenant that the foreign key to `tenants` rejects.

  The new `--tenant <uuid>` flag assigns every existing row to that tenant. The flag is required when the table has rows; without it, the migration stops and changes nothing. The tenant must exist in the `tenants` table, and the nil UUID is rejected.

### Patch Changes

- b47f84f: `stratum migrate <table>` now rejects the name of a table that Stratum's own migrations create, such as `tenants` or `usage_events`. Before, the command added `tenant_id` and a `tenant_isolation` policy to that table.
- b47f84f: `@stratum-hq/lib` exports `STRATUM_TABLES`, the list of tables that Stratum's migrations create. `stratum scan` and `stratum migrate --all` now read this list to skip Stratum's own tables, so they no longer report `abac_policies`, `usage_events`, or `principal_roles` as application tables. `stratum scan --generate` no longer emits `CREATE POLICY` for a table that already has a `tenant_isolation` policy, so the generated script applies without error.
- b47f84f: Declare sibling `@stratum-hq/*` dependencies with caret ranges instead of `"*"` or `>=`. An install now gets a sibling version that has the API the package calls, and never a future major version.
- e7e7b74: Every `tenant_isolation` policy that Stratum generates now reads the tenant with `NULLIF(current_setting('app.current_tenant_id', true), '')::uuid`, the same form as the policies in Stratum's own migrations. This applies to `createPolicy` and `createIsolationPolicy` in `@stratum-hq/db-adapters`, to `stratum migrate` and the SQL from `stratum scan --generate`, and to `setupRLSForTable` in the control plane.

  On a pooled connection, the setting reads as `''` after the transaction that set it ends. Before, a query on that connection with no tenant context failed with `invalid input syntax for type uuid: ""`. Now the query returns no rows.

  Policies that already exist in a database do not change. To update one, drop it and create it again with the new expression.

- Updated dependencies [9ed3e01]
- Updated dependencies [b47f84f]
- Updated dependencies [7e9ebcf]
- Updated dependencies [329cb16]
- Updated dependencies [b47f84f]
- Updated dependencies [b47f84f]
- Updated dependencies [e7e7b74]
- Updated dependencies [329cb16]
- Updated dependencies [cd7b950]
- Updated dependencies [7e9ebcf]
- Updated dependencies [9ed3e01]
- Updated dependencies [694a3d3]
- Updated dependencies [694a3d3]
- Updated dependencies [cd7b950]
- Updated dependencies [694a3d3]
  - @stratum-hq/lib@1.4.0
  - @stratum-hq/core@1.4.0

## 0.5.0

### Minor Changes

- 1669fd7: Harden defaults in generated projects, CLI checks, React hooks and test helpers (GHSA-rrrp-gww6-44gr). Behavior changes: `StratumProvider`'s `apiKey` is optional and generated React code uses a server-side proxy instead; `TenantThemeProvider` ignores `customCss` that is not plain declarations; `assertConfigInheritance` now takes a Stratum instance instead of a pg pool.

### Patch Changes

- dca0826: Harden API key lifecycle, JWT binding and rate limiting (GHSA-rqvw-c6qr-6x37).
- Updated dependencies [dca0826]
  - @stratum-hq/core@1.3.0

## 0.4.1

### Patch Changes

- a4f2309: Fix the table scan so it can report orphan tables again.

  The internal-table filter in `scanTables` used `NOT LIKE '\_%'` inside a JavaScript template literal. JavaScript drops the backslash from the unrecognized `\_` escape, so Postgres received `NOT LIKE '_%'`, where a bare `_` is the single-character wildcard. That predicate is false for every non-empty table name, so the scan excluded all tables and `stratum scan`, `stratum migrate`, and `stratum doctor` never surfaced a table needing tenant isolation.

  The escape is now doubled (`NOT LIKE '\\_%'`) so Postgres receives a literal `\_%`. Genuine orphan tables are reported again, while only tables whose name starts with a literal underscore (internal tables) are skipped.

- Updated dependencies [36f69d8]
  - @stratum-hq/core@1.2.1

## 0.4.0

### Minor Changes

- c17b1a5: Add an `exports` map to `@stratum-hq/control-plane` and `@stratum-hq/cli` so deep imports no longer resolve (#219, from the #133 v1.0 surface review).

  Neither package is a JS import surface: `@stratum-hq/control-plane` is a deployable server whose `index` calls `main()` on import (its 1.0 contract is the HTTP REST API and OpenAPI document), and `@stratum-hq/cli` is a bin whose contract is its command surface. Both now expose only their documented entry (`.`) and block accidental deep imports such as `@stratum-hq/control-plane/dist/routes/...`. The `stratum` bin and `node dist/index.js` startup are unchanged. If you deep-imported internals from either package (never a supported path), import from the package entry instead.

### Patch Changes

- b55ae70: Correct and complete package metadata for the npm registry listing.

  Every published package now declares `license` (MIT), `author`, `homepage`, and
  `bugs`. Runtime packages declare `engines` (Node >=20) to match the project's
  support policy; this fixes `@stratum-hq/cli`, which previously declared Node >=18.
  `@stratum-hq/mysql` and `@stratum-hq/mongodb` gain the `keywords` array they were
  missing. No runtime code changes.

- c17b1a5: Read the CLI `--version` string from `package.json` at runtime (#219, from the #133 v1.0 surface review).

  `stratum --version` hardcoded `v0.2.1` while the package was `0.3.0`, so the reported version lied. It now reads the real version from the installed `package.json`.

- c17b1a5: Give the `@stratum-hq/db-adapters` barrel one consistent naming scheme for the tenant-context helpers (#219, from the #133 v1.0 surface review).

  The barrel previously exposed the same "run in tenant context" concept under colliding names patched over with `as` aliases. The 1.0 names use an `<orm>` prefix so no export is an alias workaround:
  - `withTenant` (Prisma) -> `prismaWithTenant`
  - `withDrizzleTenant` -> `drizzleWithTenant`
  - `withTenantScope` (Sequelize) -> `sequelizeWithTenantScope`
  - `withDrizzleTenantScope` -> `drizzleWithTenantScope`
  - `enableRLSMigration` (migration helper) -> `enableRLSForMigration` (distinct from the runtime `enableRLS`)

  Behavior is identical; only the exported names change. The `@stratum-hq/cli` and `@stratum-hq/create` scaffolding templates emit the new `prismaWithTenant` name. Update your imports to the new names.

- Updated dependencies [b55ae70]
- Updated dependencies [c17b1a5]
- Updated dependencies [c17b1a5]
- Updated dependencies [5e87692]
- Updated dependencies [4adcbb5]
- Updated dependencies [c17b1a5]
  - @stratum-hq/core@1.0.0

## 0.3.0

### Minor Changes

- Security hardening release plus ecosystem polish: NestJS ALS context-leak fix, SSRF-safe webhook validation, production JWT/HKDF enforcement, fail-closed ORM adapters, SHA-pinned CI (#84); `create --preset` architecture with ORM-aware generators and Stack Wizard (#85); scaffolded projects now target Next 15 / React 19 / NestJS 11; MIT LICENSE and READMEs shipped in every package; dependency security bumps across the workspace.

### Patch Changes

- Updated dependencies
  - @stratum-hq/core@0.3.0

## 0.2.4

### Patch Changes

- Security hardening: fix NestJS tenant context leak, SSRF bypass in webhook delivery, RLS session scoping, fail-closed DB adapters, JWT secret hardening, tenant endpoint scoping, Knex INSERT injection, GitHub Actions pinning
