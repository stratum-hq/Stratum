# @stratum-hq/create

Scaffold a complete [Stratum](https://github.com/stratum-hq/Stratum) multi-tenancy project with one command: package.json, Docker Compose, environment files, and framework-specific starter code.

Read the documentation at [docs.stratum-hq.org/packages/create](https://docs.stratum-hq.org/packages/create/).

## Usage

```bash
npx @stratum-hq/create my-app
```

This creates a `my-app/` directory containing:

- `package.json` with `@stratum-hq/lib`, `pg`, `jose`, and your chosen framework
- `docker-compose.yml` with PostgreSQL 16 and the `ltree` + `uuid-ossp` extensions pre-loaded
- `.env.example` with `DATABASE_URL` and other defaults
- A starter server with tenant middleware that takes the tenant from a verified JWT
- `README.md` with getting-started instructions

## Options

```bash
npx @stratum-hq/create my-app [options]

  --template <name>   express (default), fastify, or nextjs
  --preset <preset>   a full stack, {database}-{strategy}-{orm}-{framework}
  --skip-install      skip npm install after scaffolding
  --force             overwrite an existing directory
```

`--template` and `--preset` cannot be used together.

## Templates

- **express** (default): Express server in `src/index.ts` with tenant middleware that resolves the tenant from a verified JWT, a tenant-aware `/tenants` route, and TypeScript config.
- **fastify**: Fastify server in `src/index.ts` with an `onRequest` hook that resolves the tenant from a verified JWT, a tenant-aware `/tenants` route, and TypeScript config.
- **nextjs**: Next.js 16 project with a proxy (`src/proxy.ts`, Node.js runtime) that resolves the tenant from a verified JWT. It needs Node.js 20.9 or later.

## Presets

A preset picks the database, isolation strategy, ORM, and framework in one string:

```bash
npx @stratum-hq/create my-app --preset postgres-rls-prisma-express
npx @stratum-hq/create my-app --preset postgres-schema-prisma-fastify
npx @stratum-hq/create my-app --preset mongodb-database-mongoose-hono
npx @stratum-hq/create my-app --preset mysql-table-prefix-pg-nestjs
npx @stratum-hq/create my-app --preset mysql-shared-knex-express
```

| Database | Strategies | ORMs |
|---|---|---|
| `postgres` | `rls` | `prisma`, `drizzle`, `sequelize`, `knex`, `pg` |
| `postgres` | `schema`, `database` | `prisma`, `pg` |
| `mongodb` | `database`, `collection` | `mongoose` |
| `mysql` | `database`, `table-prefix` | `pg` (the `mysql2` driver) |
| `mysql` | `shared` | `pg` (the `mysql2` driver), `knex`, `sequelize` |

Every combination in the table works with every framework: `express`, `fastify`, `nextjs`, `hono`, `nestjs`, or `none`. An invalid preset exits with an error before anything is written. The Drizzle presets write their table definitions to `src/schema.ts`, which `drizzle.config.ts` points at.

### Tenant isolation on PostgreSQL

- **rls**: all tenants share the tables. Every tenant-scoped table has a `tenant_id` column and a `tenant_isolation` row-level security policy, and the generated helper sets `app.current_tenant_id` for each tenant query. A table without a policy is not filtered by tenant. The preset creates an example table, `notes`, with its policy: in `init.sql` (pg, Knex, Sequelize), in `src/schema.ts` (Drizzle), or in `prisma/rls.sql`, which `npm run db:push` applies after `prisma db push` (Prisma). The Prisma models are in their own schema, `app`, so `prisma db push` never drops or alters Stratum's tables in `public`.
- **schema** and **database**: each tenant's tables are in its own schema, `tenant_{slug}`, or its own database, `stratum_tenant_{slug}`, and the generated helper sends each query there with the `@stratum-hq/db-adapters` adapter for the strategy: `SchemaPrismaAdapter`, `SchemaRawAdapter`, `DatabasePrismaAdapter`, or `DatabaseRawAdapter`. These presets use no row-level security. Create each tenant with Stratum, then run `npm run tenant:provision -- <tenant-id> [slug]`, which creates the tenant's schema or database and its tables and records the tenant in `provisioned_tenants`, a table the app role can only read. The helper takes the tenant ID from the verified token and looks up the slug recorded for it there, and refuses a tenant that is not provisioned; it never takes the slug from the hostname or a header. The database presets give the pool manager `DATABASE_URL`, so its settings, such as `sslmode`, apply to every tenant database. Drizzle, Sequelize, and Knex have no schema or database adapter, so the generator offers them only with `rls`.
- The name of a tenant's schema or database is fixed when the tenant is provisioned and does not follow a later change of its Stratum slug. Provisioning refuses a slug that names a provisioned schema or database, also when another tenant now has that slug in Stratum; pass another slug for the new tenant. A failed run removes what it created, so it can run again.

Tables are created by the superuser in `DATABASE_SUPERUSER_URL`, never by the app role in `DATABASE_URL`, and Stratum's own tables by Stratum's login in `STRATUM_ADMIN_DATABASE_URL`.

### Tenant isolation on MySQL

- **database**: each tenant's tables are in its own database, `stratum_tenant_{slug}`, and the generated helper sends each query there with `MysqlDatabaseAdapter` from `@stratum-hq/mysql`.
- **table-prefix**: each tenant has its own copy of each table, `{table}_{slug}`, and the generated helper names the tenant's tables with `MysqlTableAdapter`.
- **shared**: all tenants share each table, and the `tenant_id` column of a row names its tenant. See below.

For the database and table-prefix strategies, run `npm run tenant:provision -- <tenant-id> <slug>` for each tenant. It runs as the admin user in `DATABASE_SUPERUSER_URL`, creates the tenant's database or tables from `sql/tenant.sql`, gives the app user read and write access to them, and records the slug in `_stratum_tenants`. A failed run removes what it created. The app user in `DATABASE_URL` creates, alters and drops nothing, and only reads `_stratum_tenants`. The helper takes the tenant ID from the verified token and looks up the slug there; it never takes the slug from the hostname or a header. The names are fixed at provisioning, so do not change a slug or give a tenant a slug that another tenant had. `@stratum-hq/mysql` routes a tenant's own database or tables only for the `mysql2` driver, so these two strategies have no Knex or Sequelize preset.

The **shared** presets use the shared-table helper of `@stratum-hq/mysql` for their ORM: `tenantDb(tenantId)` wraps `MysqlSharedAdapter` (`mysql2`), `tenantKnex(tenantId)` wraps `withTenantScope` (Knex), and `withTenantScope(tenantId, fn)` wraps `withMysqlTenantScope` (Sequelize). The helper takes the tenant ID from the verified token and refuses an ID that is not 1 to 36 printable ASCII characters without spaces. `init.sql` creates an example tenant table, `notes`, with a `tenant_id` column that compares letter case exactly and an index that starts with `tenant_id`. The app user in `DATABASE_URL` keeps only `SELECT`, `INSERT`, `UPDATE` and `DELETE`, so tables are created and changed by the admin user in `DATABASE_SUPERUSER_URL`. There is nothing to provision. MySQL has no row-level security, so a query that does not go through the helper is not filtered by tenant. The helpers also refuse what they cannot scope: Knex joins, unions and upserts, and Sequelize `upsert()` and `truncate()`. The generated README lists each helper's limits.

### Tenant isolation on MongoDB

- **database**: each tenant's data is in its own database, `stratum_tenant_{slug}`, and `getTenantConnection(tenantId)` returns a connection to it.
- **collection**: each tenant has its own copy of each collection, `{collection}_{slug}`, and `getTenantModel(baseCollection, schema, tenantId)` returns the tenant's model.

Run `npm run db:init` once, then `npm run tenant:provision -- <tenant-id> <slug>` for each tenant. Both run as the root user in `MONGODB_ADMIN_URI`. `db:init` creates the app user in `MONGODB_URI`, which the app connects as: it reads and writes tenant data, only reads the routing records, and cannot drop anything or manage users. Provisioning records the slug in the `tenants` collection of the `{database}_routing` database, and refuses a tenant ID or slug that is already provisioned. The helpers take the tenant ID from the verified token and look up the slug there; they never take the slug from the hostname or a header.

## After Scaffolding

```bash
cd my-app
docker compose up -d   # start PostgreSQL
cp .env.example .env   # npm run dev reads .env
npm run dev            # run the app
```

The generated starter code does not create Stratum's tables. To create them, construct `Stratum` with `autoMigrate: true` and call `initialize()` once at startup. The generated `README.md` lists the remaining setup steps of the preset, such as `npm run tenant:provision` for the schema and database presets.

## Tenant resolution

Generated servers (the Express and Fastify templates, and the Express, Fastify, Hono and NestJS presets) and the Next.js proxy take the tenant ID only from the `tenant_id` claim of a bearer token that verifies with `JWT_SECRET` (HS256, using `jose`, which the generated `package.json` lists). A token that does not verify, or has no `tenant_id` claim, is rejected with 401. The tenant is never taken from the hostname or from a client-supplied header such as `x-tenant-id`. In the Next.js proxy the subdomain is forwarded as `x-tenant-slug`, a display hint that does not identify the caller's tenant.

## Links

- Documentation: https://docs.stratum-hq.org/packages/create/
- GitHub: https://github.com/stratum-hq/Stratum

## License

MIT © Christian Crank
