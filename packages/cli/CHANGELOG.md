# @stratum-hq/cli

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
