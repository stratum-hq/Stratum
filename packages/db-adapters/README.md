# @stratum-hq/db-adapters

PostgreSQL adapters for [Stratum](https://github.com/stratum-hq/Stratum) that automatically scope queries to the current tenant using Row-Level Security. Supports raw `pg`, Prisma, Drizzle, and Sequelize, plus helpers for enabling RLS on your tables.

## Installation

```bash
npm install @stratum-hq/db-adapters @stratum-hq/core pg
```

## Raw PostgreSQL

```typescript
import { Pool } from "pg";
import { RawAdapter, createTenantPool } from "@stratum-hq/db-adapters";
import { getTenantContext } from "@stratum-hq/sdk";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Automatic context from AsyncLocalStorage
const tenantPool = createTenantPool(pool, () => getTenantContext().tenant_id);
const orders = await tenantPool.query("SELECT * FROM orders");

// Or manual, per-query
const adapter = new RawAdapter(pool);
await adapter.query("tenant-id", "SELECT * FROM orders");
```

Every query is wrapped in a transaction that sets `app.current_tenant_id` via a parameterized `set_config()` (SQL-injection-safe), runs your query under the RLS policy, commits, and resets the tenant context before releasing the connection.

## ORM Adapters

```typescript
import { prismaWithTenant } from "@stratum-hq/db-adapters";        // Prisma
import { drizzleWithTenant } from "@stratum-hq/db-adapters";  // Drizzle
import { SequelizeAdapter, sequelizeWithTenantScope } from "@stratum-hq/db-adapters"; // Sequelize

// Prisma — all queries scoped to the current tenant
const tenantPrisma = prismaWithTenant(prisma, () => getTenantContext().tenant_id, pool);
const orders = await tenantPrisma.order.findMany();
```

## RLS & Migration Helpers

```typescript
import { enableRLS, createPolicy, migrateTable } from "@stratum-hq/db-adapters";

const client = await pool.connect();
try {
  await client.query("BEGIN");
  // One step: add tenant_id, enable FORCE RLS, create the isolation policy
  await migrateTable(client, "orders");
  await client.query("COMMIT");
} finally {
  client.release();
}
```

Also available: `disableRLS`, `dropPolicy`, `isRLSEnabled`, `addTenantColumn`, `createIsolationPolicy`, and low-level session helpers `setTenantContext` / `resetTenantContext` / `getCurrentTenantId`. Schema-per-tenant and database-per-tenant variants (`SchemaRawAdapter`, `DatabasePoolManager`, …) are exported too.

## Security

- All DDL validates table names against `/^[a-zA-Z_][a-zA-Z0-9_]*$/`.
- Tenant ID is always set via `set_config($1, true)` — fully parameterized.
- `enableRLS()` always applies `FORCE ROW LEVEL SECURITY`, preventing bypass by table owners.
- Always reset the tenant context when returning connections to the pool; `createTenantPool` handles this for you.

## Links

- Documentation: https://docs.stratum-hq.org/packages/db-adapters/
- GitHub: https://github.com/stratum-hq/Stratum

## License

MIT © Christian Crank
