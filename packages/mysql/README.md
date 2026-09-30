# @stratum-hq/mysql

MySQL tenant isolation for [Stratum](https://github.com/stratum-hq/Stratum). Three isolation strategies, ORM integrations, and MySQL View utilities.

## Isolation Strategies

| Strategy | Mechanism | Security Level |
|----------|-----------|----------------|
| **Shared table** | Application-level `WHERE tenant_id = ?` on all queries | App-level |
| **Table-per-tenant** | Separate tables named `{base}_{tenantSlug}` | Structural |
| **Database-per-tenant** | Separate databases per tenant, LRU-managed pool | Full |

## Quick Start

```bash
npm install @stratum-hq/mysql mysql2
```

### Shared Table (recommended for most apps)

```typescript
import mysql from "mysql2/promise";
import { MysqlSharedAdapter } from "@stratum-hq/mysql";

const pool = mysql.createPool(process.env.MYSQL_URL);
const adapter = new MysqlSharedAdapter({ pool, databaseName: "myapp" });

// Structured query methods auto-inject tenant_id
const users = await adapter.scopedSelect("tenant-a", "users");
await adapter.scopedInsert("tenant-a", "users", { name: "Alice" });
await adapter.scopedUpdate("tenant-a", "users", { name: "Bob" }, { id: 1 });
await adapter.scopedDelete("tenant-a", "users", { id: 1 });

// Raw escape hatch (you own the WHERE clause)
await adapter.unscopedRawQuery("SELECT * FROM users WHERE tenant_id = ? AND active = ?", ["tenant-a", true]);

// GDPR purge
await adapter.purgeTenantData("tenant-a");
```

### Table-per-Tenant

```typescript
import { MysqlTableAdapter } from "@stratum-hq/mysql";

const adapter = new MysqlTableAdapter({
  pool,
  databaseName: "myapp",
  // Every base table that has a per-tenant copy. Required by scopedTable and purgeTenantData.
  baseTables: ["users", "orders"],
});

// Returns escaped table name: `users_tenanta`
const tableName = adapter.scopedTable("tenanta", "users");

// Use the pool directly with the scoped table name
const [rows] = await pool.query(`SELECT * FROM ${tableName}`);
```

### Database-per-Tenant

```typescript
import { MysqlDatabaseAdapter } from "@stratum-hq/mysql";

const adapter = new MysqlDatabaseAdapter({
  createPool: (uri) => mysql.createPool(uri),
  baseUri: "mysql://root@localhost:3306/placeholder",
  maxPools: 20,
  idleTimeoutMs: 60000,
});

// Returns a pool connected to stratum_tenant_tenanta
const tenantPool = await adapter.getPool("tenanta");
const [rows] = await tenantPool.query("SELECT * FROM users");

// Clean up on shutdown
await adapter.closeAll();
```

## ORM Integrations

### TypeORM Subscriber

```typescript
import { registerStratumSubscriber } from "@stratum-hq/mysql";

await dataSource.initialize();
// Adds one StratumTypeOrmSubscriber. A second call adds nothing.
registerStratumSubscriber(dataSource);
```

Call `registerStratumSubscriber()` after `dataSource.initialize()`. It throws before that, because `initialize()` replaces the subscriber list. Do not put `StratumTypeOrmSubscriber` in the `subscribers` option: TypeORM only loads classes decorated with `@EventSubscriber()` from that option.

Inserts get the current tenant's `tenant_id`. Updates never change `tenant_id`: `save()` keeps the loaded value, and `update()` / query builder updates drop it from the SET values.

`registerStratumSubscriber()` also scopes updates and deletes to the current tenant: repository `update()`, `delete()`, `softDelete()`, `restore()`, `save()` of an existing row, `remove()`, and query builder updates and deletes get `tenant_id = <current tenant>` ANDed to their WHERE clause. A row of another tenant is left unchanged, and an update or delete of a tenant table outside a tenant context is refused. `save()` of a row that belongs to another tenant throws: before an insert (other than an upsert) whose entity supplies its whole primary key, the subscriber looks that key up without the read scope, uses the result only for this check, and refuses the insert when the row belongs to another tenant. An update or delete builder aimed at a raw table name (not an entity) is treated as a tenant table and always gets the tenant condition, so it fails on a table without `tenant_id`. `TRUNCATE` of a table with a `tenant_id` column (`repository.clear()`, `queryRunner.clearTable()`) is refused, because it would remove every tenant's rows. A subscriber added to `dataSource.subscribers` by hand refuses every UPDATE and DELETE, so always register it with `registerStratumSubscriber()`.

Upserts (`repository.upsert()` and `.orUpdate()`) also get the current tenant's `tenant_id` on insert. If the conflict update writes `tenant_id`, the subscriber rejects the statement before it runs. To upsert, leave `tenant_id` out of the entity values and out of the `orUpdate()` columns.

MySQL applies `ON DUPLICATE KEY UPDATE` on a conflict with any unique key of the table, whatever conflict columns you pass. The subscriber therefore allows an upsert only when every unique key of the target table, including the primary key, contains `tenant_id` (for example `PRIMARY KEY (tenant_id, id)`). It reads the keys from `information_schema` before the statement runs, and rejects the upsert otherwise.

`registerStratumSubscriber()` also scopes reads. Every query that TypeORM's select query builder builds on the data source gets `tenant_id = <current tenant>`: repository `find*()`, `findOne*()`, `count*()`, `exists*()`, `sum()` / `average()` / `minimum()` / `maximum()` and `preload()`, query builder `getMany()`, `getOne()`, `getRawMany()`, `getRawOne()`, `getCount()`, `getManyAndCount()`, `getExists()` and `stream()`, relation loading (joins, eager relations, `relationLoadStrategy: "query"`), the row that `save()` loads before it writes, subqueries, and the count and pagination queries TypeORM builds internally. The condition is ANDed to the WHERE clause for the entity in FROM, so an `orWhere()` cannot widen the read, and it is added to the ON condition of every joined entity with a `tenant_id` column, so `leftJoinAndSelect()` still returns the parent row and leaves another tenant's related row out. A read of an entity with a `tenant_id` column outside a tenant context is refused. Entities without a `tenant_id` column, and data sources without the subscriber, are not affected.

**Limitation:** raw SQL (`dataSource.query()`, `queryRunner.query()`), SQL taken from `getQuery()` / `getQueryAndParameters()` and run by hand (a select builder's SQL includes the tenant condition, but an update or delete builder adds it only when its `execute()` runs), reads from a table that has no entity on the data source, and many-to-many junction tables are not scoped. Add the tenant condition to those yourself, or use the shared-table adapter's structured methods.

### Knex Helper

```typescript
import { withTenantScope } from "@stratum-hq/mysql";

const tenantKnex = withTenantScope(knex, "tenant-a");
const users = await tenantKnex("users").where("name", "like", q).orWhere("email", "like", q);
// Compiles to: WHERE tenant_id = 'tenant-a' AND (name LIKE ? OR email LIKE ?)
```

Your where clauses are always grouped after the tenant filter, including on clones and when the builder is used as a subquery. `insert()` sets `tenant_id`, `update()` never changes it, and `onConflict().merge()`, `upsert()`, `truncate()` and `modify()` throw (a `modify()` callback would call the builder without these rules).

Joins (`join()`, `leftJoin()`, `crossJoin()`, `joinRaw()` and the other join forms) and `union()` / `unionAll()` also throw, because the tenant filter covers only the builder's own table. To combine tables, use a tenant-scoped builder as a `whereIn()` subquery, or write the query with plain Knex and a `tenant_id` condition on every table.

### Sequelize Adapter

```typescript
import { withMysqlTenantScope } from "@stratum-hq/mysql";

await withMysqlTenantScope(sequelize, "tenant-a", async (scoped, transaction) => {
  // @stratum_tenant_id is set on the transaction's connection only.
  // Pass the transaction to every query, or it runs on another connection.
  // Guaranteed cleanup via try/finally, even on errors
  const [rows] = await scoped.query("SELECT @stratum_tenant_id", { transaction });
});
```

## MySQL Views (not supported)

`createTenantView()` is deprecated and always throws. MySQL does not allow a view to read a session variable (`ER_VIEW_SELECT_VARIABLE`), so a view filtered on `@stratum_tenant_id` cannot be created. Use the shared-table adapter's scoped methods. `setTenantSession()` and `dropTenantView()` remain available.

## GDPR Compliance

All three adapters implement `purgeTenantData(tenantSlug)`:

- **Shared table**: discovers tenant tables via `INFORMATION_SCHEMA`, then `DELETE FROM table WHERE tenant_id = ?`
- **Table-per-tenant**: `DROP TABLE` for exactly `{base}_{slug}` for each entry in the `baseTables` option, which it requires
- **Database-per-tenant**: `DROP DATABASE stratum_tenant_slug`

## License

MIT
