---
"@stratum-hq/mysql": patch
---

The documented examples now compile under `tsc --strict` against the mysql2, Knex and Sequelize types:

- A mysql2 `Pool` is assignable to `MysqlPoolLike`. `MysqlConnectionLike.execute()` takes `MysqlExecuteValue[]`, which mysql2 accepts, and `MysqlPoolLike.query()` resolves to a `[rows, fields]` tuple, so `const [rows] = await tenantPool.query(...)` compiles.
- `withTenantScope(knex, tenantId)` returns the builder type of the Knex instance given. For a real Knex instance, that is Knex's `QueryBuilder`, so `orWhere()` and the three-argument `where()` compile. The runtime behavior does not change: the methods that the scope refuses still throw.
- The `transaction` argument of the `withMysqlTenantScope()` callback has the Sequelize `Transaction` type, so `{ transaction }` can go into Sequelize query options.
