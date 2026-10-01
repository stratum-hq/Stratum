---
"@stratum-hq/create": minor
---

Generate strategy-specific tenant helpers, tenant provisioning and row-level security policies for the PostgreSQL and MySQL presets (GHSA-r5mc-55fv-2cvp).

- PostgreSQL: the `schema` and `database` presets are now offered only for Prisma and `pg`; `postgres-schema-*` and `postgres-database-*` with Drizzle, Sequelize or Knex are no longer valid presets. Tenant provisioning runs as the superuser, so `init.sql` no longer gives the app role `CREATE` on the database or `CREATEDB`. The Prisma models of the `rls` presets are in their own schema, `app`.
- MySQL: the `database` and `table-prefix` presets route each tenant with `MysqlDatabaseAdapter` or `MysqlTableAdapter` from `@stratum-hq/mysql`, look up the tenant's slug in `_stratum_tenants`, and provision tenants as the admin user with `npm run tenant:provision`. They are now offered only for the `mysql2` driver (`pg`); `mysql-*-sequelize-*` and `mysql-*-knex-*` are no longer valid presets.

Upgrade note: if you generated a project from a `postgres-schema-*`, `postgres-database-*` or `mysql-*` preset with an earlier version, review its tenant helper and compare it with what this version generates for the same preset.
