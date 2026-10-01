# @stratum-hq/create

## 0.8.0

### Minor Changes

- 75e877f: Add the MySQL `shared` strategy: `mysql-shared-pg-*`, `mysql-shared-knex-*` and `mysql-shared-sequelize-*`. All tenants share each table, and the generated helper scopes each query with the `@stratum-hq/mysql` helper of the ORM: `MysqlSharedAdapter` for the `mysql2` driver, `withTenantScope` for Knex, and `withMysqlTenantScope` for Sequelize. The helper takes the tenant ID from the verified token and refuses an ID with spaces. `init.sql` creates an example tenant table and leaves the app user only `SELECT`, `INSERT`, `UPDATE` and `DELETE`. The generated README lists what each helper does not scope.

  The MySQL `database` and `table-prefix` presets also check the tenant ID with the same rule before they look up its slug.

## 0.7.0

### Minor Changes

- 92d8c9c: Generate strategy-specific tenant helpers, tenant provisioning and row-level security policies for the PostgreSQL and MySQL presets (GHSA-r5mc-55fv-2cvp).

  - PostgreSQL: the `schema` and `database` presets are now offered only for Prisma and `pg`; `postgres-schema-*` and `postgres-database-*` with Drizzle, Sequelize or Knex are no longer valid presets. Tenant provisioning runs as the superuser, so `init.sql` no longer gives the app role `CREATE` on the database or `CREATEDB`. The Prisma models of the `rls` presets are in their own schema, `app`.
  - MySQL: the `database` and `table-prefix` presets route each tenant with `MysqlDatabaseAdapter` or `MysqlTableAdapter` from `@stratum-hq/mysql`, look up the tenant's slug in `_stratum_tenants`, and provision tenants as the admin user with `npm run tenant:provision`. They are now offered only for the `mysql2` driver (`pg`); `mysql-*-sequelize-*` and `mysql-*-knex-*` are no longer valid presets.

  - PostgreSQL `schema` and `database` presets: `npm run tenant:provision -- <tenant-id> [slug]` records each tenant in `provisioned_tenants`, which the app role can only read, and the tenant helper reads the tenant's slug there by the verified tenant ID. A tenant keeps its schema or database when its Stratum slug changes, and provisioning refuses a slug that names a provisioned schema or database. A failed run removes what it created. The `database` presets give `DatabasePoolManager` the `DATABASE_URL` connection string, so settings such as `sslmode` apply to every tenant database, and each new tenant database keeps `PUBLIC` from creating objects or temporary tables.
  - MySQL: `init.sql` leaves the app user read access to `_stratum_tenants` only, and provisioning grants it read and write access to each tenant's own database or tables. `_stratum_tenants.id` compares byte for byte. Provisioning checks the tenant ID before it creates anything and removes what a failed run created.
  - MongoDB: the app connects as its own user, which `npm run db:init` creates; `db:init` and `npm run tenant:provision -- <tenant-id> <slug>` run as the admin user in `MONGODB_ADMIN_URI`. `getTenantModel` and `getTenantConnection` take the verified tenant ID and look up the slug that provisioning recorded.
  - The Sequelize `rls` example model maps the `notes` table, and the Knex `rls` knexfile runs migrations as the superuser in `DATABASE_SUPERUSER_URL`, with `appConfig` for the app.

  Upgrade note: if you generated a project from a `postgres-schema-*`, `postgres-database-*`, `mysql-*` or `mongodb-*` preset with an earlier version, review its tenant helper, provisioning script and `init.sql`, and compare them with what this version generates for the same preset. The MongoDB presets now take a tenant ID in `getTenantModel` and `getTenantConnection`, where they took a slug.

- c00e5d5: Move the Next.js templates to Next.js 16.

  `@stratum-hq/create` now generates Next.js projects with `next` `^16.3.8` and `react` `^19.2.0`. Every Next.js release before 16.3.0 bundles a `postcss` with published advisories. The tenant check is now `src/proxy.ts`, which exports `proxy` and runs on the Node.js runtime. It still verifies the JWT and still removes a client-sent tenant header. Generated Next.js projects need Node.js 20.9 or later. The generated `tsconfig.json` has the options that `next build` on Next.js 16 adds, so the first build does not change it.

  `stratum init` and `stratum scaffold nextjs` read the Next.js version of the project, from `node_modules/next` first, else from `package.json`. Next.js 16 and later get `proxy.ts`. Next.js 15 gets `middleware.ts`. When the version is unknown, they write `middleware.ts`, which Next.js 15 and 16 both run, and print the codemod that renames it. They never write one of the two files next to the other, even with `--force`: Next.js 16 refuses a project that has both, and Next.js 15 ignores `proxy.ts`.

  Existing projects need no change. Next.js 16 still runs `middleware.ts` and prints a deprecation warning. To move a project to `proxy.ts`, run `npx @next/codemod@canary middleware-to-proxy .`. The file must sit next to the app directory: `src/proxy.ts` for `src/app`, `proxy.ts` for `app`.

## 0.6.0

### Minor Changes

- 99437c5: The Next.js template and every Next.js preset now write the tenant middleware to `src/middleware.ts`, next to the `src/app` directory, so Next.js runs it. Previously it was written to the project root, where Next.js ignores it when the app lives in `src/app`, so the tenant JWT was not verified and a client-supplied `x-tenant-id` header reached server code. The generated app also gets the root layout (`src/app/layout.tsx`) that `next build` requires, and the Next.js presets get a `tsconfig.json` that `next build` accepts (bundler module resolution, no `rootDir`). If you generated a Next.js project with an earlier version, move `middleware.ts` to `src/middleware.ts`. See GHSA-mg93-96h7-h9fq.
- 99437c5: Generated PostgreSQL projects follow the hardened role model (GHSA-mg93-96h7-h9fq): `init.sql` creates the control role and a separate login for Stratum (`STRATUM_ADMIN_DATABASE_URL`, the library's `adminPool`), gives the application role no `CREATE` on `public`, and limits its default privileges to the tables the bootstrap superuser creates. Run the Stratum migrations as the Stratum login.
- 99437c5: Generated PostgreSQL projects name the bootstrap superuser URL `DATABASE_SUPERUSER_URL` (was `DATABASE_ADMIN_URL`, which the library uses for its admin login), and schema-per-tenant projects keep the schemas the app creates off the search path of the Stratum login and the superuser (GHSA-mg93-96h7-h9fq).
- 99437c5: The `express` and `fastify` templates now generate the tenant middleware the docs describe: the tenant comes from the `tenant_id` claim of a bearer token verified with `JWT_SECRET` (HS256, using `jose`, now a dependency of every template), and `GET /tenants` answers 401 without one. The servers are the same as the express and fastify presets write. The generated README no longer points these templates at a `src/middleware.ts` that does not exist.

  The Drizzle presets now pin `drizzle-orm ^0.45.3` and `drizzle-kit ^0.31.11`, override the esbuild that drizzle-kit pulls in through `@esbuild-kit/core-utils` to `^0.25.4`, and generate the `src/schema.ts` that `drizzle.config.ts` points at. On PostgreSQL, `drizzle.config.ts` connects with `DATABASE_ADMIN_URL` when it is set.

  Generated dependency ranges now start past published advisories: `fastify ^5.12.5` (was `^4.26.0`, a major upgrade), `express ^4.22.3`, `hono ^4.13.7`, `@hono/node-server ^1.19.15`, `@nestjs/core`, `@nestjs/common` and `@nestjs/platform-express ^11.1.18`, `mongoose ^8.24.1`, `mysql2 ^3.23.1`, and `tsx ^4.19.3`.

  An invalid `--preset` now exits before anything is written, so it no longer leaves an empty project directory, and with `--force` it no longer removes the existing one.

## 0.5.1

### Patch Changes

- b737034: Improve the npm metadata so that npm search finds the packages. Each `description` now starts with the problem the package solves. Each package carries the same multi-tenancy keywords, including `multitenancy`. The `homepage` field now points at the package's page on https://docs.stratum-hq.org instead of a GitHub folder. The first lines of each README link the documentation. No code changes.
- a1bd9aa: Replace em dashes in user-visible text with ordinary punctuation. This touches READMEs, package descriptions, CLI output, control plane startup log messages, the text that `@stratum-hq/create` writes into generated projects, and the assertion messages in `@stratum-hq/test-utils`. The CLI `health` and `migrate` tables now print `no` instead of a dash for an unset flag. No behavior changes.

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
