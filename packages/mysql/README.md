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
await adapter.scopedRawQuery("SELECT * FROM users WHERE tenant_id = ? AND active = ?", ["tenant-a", true]);

// GDPR purge
await adapter.purgeTenantData("tenant-a");
```

### Table-per-Tenant

```typescript
import { MysqlTableAdapter } from "@stratum-hq/mysql";

const adapter = new MysqlTableAdapter({ pool, databaseName: "myapp" });

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

### TypeORM Subscriber (writes only)

```typescript
import { StratumTypeOrmSubscriber } from "@stratum-hq/mysql";

// Add to your TypeORM data source subscribers
const dataSource = new DataSource({
  subscribers: [StratumTypeOrmSubscriber],
});
```

**Limitation:** TypeORM subscribers can intercept writes but not reads. Use the shared-table adapter's structured methods for tenant-scoped reads.

### Knex Helper

```typescript
import { withTenantScope } from "@stratum-hq/mysql";

const tenantKnex = withTenantScope(knex, "tenant-a");
const users = await tenantKnex("users").select("*");
// Automatically adds: WHERE tenant_id = 'tenant-a'
```

### Sequelize Adapter

```typescript
import { withMysqlTenantScope } from "@stratum-hq/mysql";

await withMysqlTenantScope(sequelize, "tenant-a", async (scoped) => {
  // Session variable @stratum_tenant_id is set for this scope
  // Guaranteed cleanup via try/finally, even on errors
  const users = await scoped.query("SELECT * FROM users_view");
});
```

## MySQL Views (convenience layer)

Views provide a convenient way to create tenant-scoped read access using MySQL session variables.

```typescript
import { createTenantView, setTenantSession } from "@stratum-hq/mysql";

// Create a view that filters by @stratum_tenant_id
await createTenantView(pool, "users");
// Creates: CREATE OR REPLACE VIEW users_tenant_view AS
//          SELECT * FROM users WHERE tenant_id = @stratum_tenant_id

// Set the session variable, then query the view
const conn = await pool.getConnection();
await setTenantSession(conn, "tenant-a");
const [rows] = await conn.query("SELECT * FROM users_tenant_view");
conn.release();
```

**Important:** Views are NOT a security boundary (unlike Postgres RLS). Queries to underlying tables bypass isolation entirely. Views referencing session variables may not use indexes efficiently on large tables. Use the shared-table adapter's structured methods for high-performance workloads.

## GDPR Compliance

All three adapters implement `purgeTenantData(tenantSlug)`:

- **Shared table**: discovers tenant tables via `INFORMATION_SCHEMA`, then `DELETE FROM table WHERE tenant_id = ?`
- **Table-per-tenant**: discovers tables via `SHOW TABLES LIKE '%_slug'`, then `DROP TABLE`
- **Database-per-tenant**: `DROP DATABASE stratum_tenant_slug`

## License

MIT
