# @stratum-hq/create

## 0.5.0

### Minor Changes

- 4c1686a: Generated servers and Next.js middleware take the tenant from a verified JWT instead of the hostname (GHSA-p4wg-j8hh-9wh8).

## 0.4.1

### Patch Changes

- 7ac4283: `npx @stratum-hq/create <name>` now runs the scaffolder. Before this fix, the command exited 0 and did nothing when npm ran the bin through its `node_modules/.bin` symlink. The `create-stratum` bin is now `dist/bin.js`, which always calls `main()`.
- 7ac4283: Generated projects now depend on the current `@stratum-hq/*` releases. The CLI took the dependency ranges from a hardcoded `^0.2.0`, which installs releases from before 1.0. The build now reads the ranges from the workspace package versions.
- 7ac4283: Fix the database setup that the pg, knex and mongoose presets generate, so that it compiles and runs against the published packages.

  - The PostgreSQL `pg` preset passes a tenant function to `createTenantPool`, which expects `() => string`.
  - The PostgreSQL `knex` preset sets `app.current_tenant_id` with `set_config(..., true)` inside `knex.transaction`. PostgreSQL does not accept a bind parameter in `SET`, and the RLS policies read `app.current_tenant_id`.
  - The `mongoose` presets no longer import `createTenantConnection`, which `@stratum-hq/mongodb` does not export. They use Mongoose directly, with the database and collection names of the `@stratum-hq/mongodb` adapters.
  - The MySQL `pg` preset types its query parameters so that `pool.execute` accepts them.
  - The generated README names the `app.current_tenant_id` setting.
  - The RLS policy example in the generated `init.sql` uses `NULLIF(current_setting('app.current_tenant_id', true), '')::uuid`. A pooled connection reads the setting as an empty string after a tenant transaction ends, and the old example raised an error there instead of returning no rows.

- 7ac4283: Generated projects now run with the scripts they ship. The express and fastify templates now write a `tsconfig.json`, so `npm run build` compiles `src/` to `dist/` and `npm start` runs `dist/index.js`. The `dev` script of the templates and of every preset except Next.js and NestJS is now `tsx watch --env-file=.env src/<entry>.ts`, because Node 20 cannot run a `.ts` file. The NestJS preset `dev` script is now `tsc-watch --onSuccess "node --env-file=.env dist/main.js"`, because NestJS injection needs the decorator metadata that `tsc` emits. Before this fix, `dev` pointed at `src/index.js`, which the scaffold never wrote. Knex presets now compile from the project root, because `src/stratum-knex.ts` imports `knexfile.ts` from there. Their `start` script runs `dist/src/<entry>.js`. The generated README and the success message now tell you to run `npm run dev`.

## 0.4.0

### Minor Changes

- 1669fd7: Harden defaults in generated projects, CLI checks, React hooks and test helpers (GHSA-rrrp-gww6-44gr). Behavior changes: `StratumProvider`'s `apiKey` is optional and generated React code uses a server-side proxy instead; `TenantThemeProvider` ignores `customCss` that is not plain declarations; `assertConfigInheritance` now takes a Stratum instance instead of a pg pool.

### Patch Changes

- 9de2ddb: Remove unused code from the generator. No change in generated output.
- dca0826: Harden tenant isolation in the schema-per-tenant and database-per-tenant strategies and the Prisma and Drizzle adapters (GHSA-jhhc-cm2c-jh27). Behavior change: the schema-per-tenant `search_path` is now the tenant schema alone, without `public`; queries that call extension functions or types from another schema must schema-qualify them or opt that schema in with the new `extraSearchPath` option.

## 0.3.1

### Patch Changes

- b55ae70: Correct and complete package metadata for the npm registry listing.

  Every published package now declares `license` (MIT), `author`, `homepage`, and
  `bugs`. Runtime packages declare `engines` (Node >=20) to match the project's
  support policy; this fixes `@stratum-hq/cli`, which previously declared Node >=18.
  `@stratum-hq/mysql` and `@stratum-hq/mongodb` gain the `keywords` array they were
  missing. No runtime code changes.

- c17b1a5: Point `@stratum-hq/create`'s `exports["./matrix"]` at built output instead of raw source (#219, from the #133 v1.0 surface review).

  The `./matrix` subpath previously resolved (and shipped) `./src/matrix.ts` for both the `import` and `types` conditions, blessing a raw-source subpath unlike every other package. The build now emits `dist/matrix.js` and `./matrix` resolves there, matching the package's `.` entry. The stack-combination matrix API is unchanged.

- c17b1a5: Give the `@stratum-hq/db-adapters` barrel one consistent naming scheme for the tenant-context helpers (#219, from the #133 v1.0 surface review).

  The barrel previously exposed the same "run in tenant context" concept under colliding names patched over with `as` aliases. The 1.0 names use an `<orm>` prefix so no export is an alias workaround:
  - `withTenant` (Prisma) -> `prismaWithTenant`
  - `withDrizzleTenant` -> `drizzleWithTenant`
  - `withTenantScope` (Sequelize) -> `sequelizeWithTenantScope`
  - `withDrizzleTenantScope` -> `drizzleWithTenantScope`
  - `enableRLSMigration` (migration helper) -> `enableRLSForMigration` (distinct from the runtime `enableRLS`)

  Behavior is identical; only the exported names change. The `@stratum-hq/cli` and `@stratum-hq/create` scaffolding templates emit the new `prismaWithTenant` name. Update your imports to the new names.

- 4adcbb5: Stop shipping test files in published tarballs. tsc-built packages now exclude **tests** directories and .test/.spec files from compilation, so dist and the tarball contain only real package output. The create package, which ships source for its ./matrix export, excludes tests via .npmignore instead. The vitest runner is unaffected and still runs tests from src.

## 0.3.0

### Minor Changes

- Security hardening release plus ecosystem polish: NestJS ALS context-leak fix, SSRF-safe webhook validation, production JWT/HKDF enforcement, fail-closed ORM adapters, SHA-pinned CI (#84); `create --preset` architecture with ORM-aware generators and Stack Wizard (#85); scaffolded projects now target Next 15 / React 19 / NestJS 11; MIT LICENSE and READMEs shipped in every package; dependency security bumps across the workspace.

## 0.2.3

### Patch Changes

- Security hardening: fix NestJS tenant context leak, SSRF bypass in webhook delivery, RLS session scoping, fail-closed DB adapters, JWT secret hardening, tenant endpoint scoping, Knex INSERT injection, GitHub Actions pinning
