---
"@stratum-hq/create": minor
---

Add the MySQL `shared` strategy: `mysql-shared-pg-*`, `mysql-shared-knex-*` and `mysql-shared-sequelize-*`. All tenants share each table, and the generated helper scopes each query with the `@stratum-hq/mysql` helper of the ORM: `MysqlSharedAdapter` for the `mysql2` driver, `withTenantScope` for Knex, and `withMysqlTenantScope` for Sequelize. The helper takes the tenant ID from the verified token and refuses an ID with spaces. `init.sql` creates an example tenant table and leaves the app user only `SELECT`, `INSERT`, `UPDATE` and `DELETE`. The generated README lists what each helper does not scope.

The MySQL `database` and `table-prefix` presets also check the tenant ID with the same rule before they look up its slug.
