# @stratum/db-adapters

PostgreSQL adapters for tenant-scoped query isolation using Row-Level Security.

## Installation

```bash
npm install @stratum/db-adapters @stratum/core pg
```

## Adapters

### Raw PostgreSQL (pg)

For applications using `pg` (node-postgres) directly.

```typescript
import { Pool } from "pg";
import { RawAdapter, createTenantPool } from "@stratum/db-adapters";
import { getTenantContext } from "@stratum/sdk";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Option 1: Automatic context from AsyncLocalStorage
const tenantPool = createTenantPool(pool, () => getTenantContext().tenant_id);
const result = await tenantPool.query("SELECT * FROM orders");

// Option 2: Manual adapter usage
const adapter = new RawAdapter(pool);
const result = await adapter.query("tenant-id", "SELECT * FROM orders");
```

The adapter wraps every query in a transaction that:
1. Calls `BEGIN`
2. Sets `app.current_tenant_id` via parameterized `set_config()`
3. Executes your query
4. Calls `COMMIT`
5. Resets the tenant context and releases the connection

### Prisma

For applications using Prisma ORM.

```typescript
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { withTenant } from "@stratum/db-adapters";
import { getTenantContext } from "@stratum/sdk";

const prisma = new PrismaClient();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const tenantPrisma = withTenant(
  prisma,
  () => getTenantContext().tenant_id,
  pool,
);

// All queries automatically scoped to the current tenant
const orders = await tenantPrisma.order.findMany();
```

## RLS Management

### Enable RLS on a Table

```typescript
import { enableRLS, createPolicy } from "@stratum/db-adapters";

const client = await pool.connect();
try {
  await enableRLS(client, "orders");       // ENABLE + FORCE ROW LEVEL SECURITY
  await createPolicy(client, "orders");     // CREATE POLICY tenant_isolation
} finally {
  client.release();
}
```

### Disable RLS

```typescript
import { dropPolicy, disableRLS } from "@stratum/db-adapters";

await dropPolicy(client, "orders");
await disableRLS(client, "orders");
```

### Check RLS Status

```typescript
import { isRLSEnabled } from "@stratum/db-adapters";

const enabled = await isRLSEnabled(client, "orders"); // true/false
```

## Migration Helpers

One-step table migration that adds `tenant_id`, enables RLS, and creates the isolation policy:

```typescript
import { migrateTable } from "@stratum/db-adapters";

const client = await pool.connect();
try {
  await client.query("BEGIN");
  await migrateTable(client, "orders");
  await client.query("COMMIT");
} finally {
  client.release();
}
```

Or step-by-step:

```typescript
import {
  addTenantColumn,
  enableRLS,
  createIsolationPolicy,
} from "@stratum/db-adapters";

await addTenantColumn(client, "orders");      // ALTER TABLE ADD tenant_id UUID NOT NULL
await enableRLS(client, "orders");             // ENABLE + FORCE ROW LEVEL SECURITY
await createIsolationPolicy(client, "orders"); // CREATE POLICY tenant_isolation
```

## Session Context

Low-level functions for managing the PostgreSQL session variable:

```typescript
import {
  setTenantContext,
  resetTenantContext,
  getCurrentTenantId,
} from "@stratum/db-adapters";

await setTenantContext(client, "tenant-uuid");
const id = await getCurrentTenantId(client);   // "tenant-uuid"
await resetTenantContext(client);               // RESET app.current_tenant_id
```

## Security

- **Table name validation**: All DDL operations validate table names against `/^[a-zA-Z_][a-zA-Z0-9_]*$/`
- **Parameterized context**: Tenant ID is set via `SELECT set_config('app.current_tenant_id', $1, true)` — fully parameterized
- **FORCE RLS**: `enableRLS()` always enables FORCE, so even table owners can't bypass policies
- **Connection cleanup**: Always reset tenant context when releasing connections back to the pool
