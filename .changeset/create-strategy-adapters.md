---
"@stratum-hq/create": minor
---

Generate strategy-specific tenant helpers, tenant provisioning and row-level security policies for the PostgreSQL and MySQL presets (GHSA-r5mc-55fv-2cvp).

- PostgreSQL: the `schema` and `database` presets are now offered only for Prisma and `pg`; `postgres-schema-*` and `postgres-database-*` with Drizzle, Sequelize or Knex are no longer valid presets. Tenant provisioning runs as the superuser, so `init.sql` no longer gives the app role `CREATE` on the database or `CREATEDB`. The Prisma models of the `rls` presets are in their own schema, `app`.
- MySQL: the `database` and `table-prefix` presets route each tenant with `MysqlDatabaseAdapter` or `MysqlTableAdapter` from `@stratum-hq/mysql`, look up the tenant's slug in `_stratum_tenants`, and provision tenants as the admin user with `npm run tenant:provision`. They are now offered only for the `mysql2` driver (`pg`); `mysql-*-sequelize-*` and `mysql-*-knex-*` are no longer valid presets.

- PostgreSQL `schema` and `database` presets: `npm run tenant:provision -- <tenant-id> [slug]` records each tenant in `provisioned_tenants`, which the app role can only read, and the tenant helper reads the tenant's slug there by the verified tenant ID. A tenant keeps its schema or database when its Stratum slug changes, and provisioning refuses a slug that names a provisioned schema or database. A failed run removes what it created. The `database` presets give `DatabasePoolManager` the `DATABASE_URL` connection string, so settings such as `sslmode` apply to every tenant database, and each new tenant database keeps `PUBLIC` from creating objects or temporary tables.
- MySQL: `init.sql` leaves the app user read access to `_stratum_tenants` only, and provisioning grants it read and write access to each tenant's own database or tables. `_stratum_tenants.id` compares byte for byte. Provisioning checks the tenant ID before it creates anything and removes what a failed run created.
- MongoDB: the app connects as its own user, which `npm run db:init` creates; `db:init` and `npm run tenant:provision -- <tenant-id> <slug>` run as the admin user in `MONGODB_ADMIN_URI`. `getTenantModel` and `getTenantConnection` take the verified tenant ID and look up the slug that provisioning recorded.
- The Sequelize `rls` example model maps the `notes` table, and the Knex `rls` knexfile runs migrations as the superuser in `DATABASE_SUPERUSER_URL`, with `appConfig` for the app.

Upgrade note: if you generated a project from a `postgres-schema-*`, `postgres-database-*`, `mysql-*` or `mongodb-*` preset with an earlier version, review its tenant helper, provisioning script and `init.sql`, and compare them with what this version generates for the same preset. The MongoDB presets now take a tenant ID in `getTenantModel` and `getTenantConnection`, where they took a slug.
