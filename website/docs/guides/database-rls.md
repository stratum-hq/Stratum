---
sidebar_position: 5
title: Database & RLS Setup
---

# Database & RLS Setup

Add PostgreSQL Row-Level Security isolation to your existing tables using `@stratum/db-adapters`.

## How RLS Works

1. Each tenant-scoped table has a `tenant_id` column
2. An RLS policy filters rows: `tenant_id = current_setting('app.current_tenant_id')::uuid`
3. Before each query, the adapter sets `app.current_tenant_id` via `set_config()`
4. PostgreSQL automatically filters — **no WHERE clause needed**
5. The context is reset when the connection returns to the pool

## Installation

```bash
npm install @stratum/db-adapters @stratum/core pg
```

## Adding RLS to Existing Tables

### One-Step Migration

```typescript
import { Pool } from "pg";
import { migrateTable } from "@stratum/db-adapters";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();

try {
  await client.query("BEGIN");
  await migrateTable(client, "orders");
  await client.query("COMMIT");
} finally {
  client.release();
}
```

This single call:
1. Adds `tenant_id UUID NOT NULL` column
2. Enables `ROW LEVEL SECURITY`
3. Enables `FORCE ROW LEVEL SECURITY`
4. Creates `tenant_isolation` policy

### Step-by-Step Migration

```typescript
import {
  addTenantColumn,
  enableRLS,
  createIsolationPolicy,
} from "@stratum/db-adapters";

await addTenantColumn(client, "orders");
await enableRLS(client, "orders");
await createIsolationPolicy(client, "orders");
```

### Multiple Tables

```typescript
const tables = ["orders", "invoices", "products", "audit_logs"];

const client = await pool.connect();
try {
  await client.query("BEGIN");
  for (const table of tables) {
    await migrateTable(client, table);
  }
  await client.query("COMMIT");
} finally {
  client.release();
}
```

## Querying with RLS

### Raw pg

```typescript
import { createTenantPool } from "@stratum/db-adapters";
import { getTenantContext } from "@stratum/sdk";

const tenantPool = createTenantPool(pool, () => getTenantContext().tenant_id);

// No WHERE tenant_id = ... needed! RLS handles it.
const orders = await tenantPool.query("SELECT * FROM orders");
const invoices = await tenantPool.query(
  "SELECT * FROM invoices WHERE status = $1",
  ["pending"]
);
```

### Manual Adapter

```typescript
import { RawAdapter } from "@stratum/db-adapters";

const adapter = new RawAdapter(pool);

// Explicit tenant ID
const orders = await adapter.query(tenantId, "SELECT * FROM orders");
```

### Prisma

```typescript
import { PrismaClient } from "@prisma/client";
import { withTenant } from "@stratum/db-adapters";
import { getTenantContext } from "@stratum/sdk";

const prisma = new PrismaClient();
const tenantPrisma = withTenant(
  prisma,
  () => getTenantContext().tenant_id,
  pool,
);

// All Prisma queries are automatically tenant-scoped
const orders = await tenantPrisma.order.findMany();
const count = await tenantPrisma.order.count();
```

## Manual Context Management

For advanced cases, manage the PostgreSQL session variable directly:

```typescript
import {
  setTenantContext,
  resetTenantContext,
  getCurrentTenantId,
} from "@stratum/db-adapters";

const client = await pool.connect();
try {
  await client.query("BEGIN");
  await setTenantContext(client, tenantId);

  // All queries in this transaction are tenant-scoped
  const result = await client.query("SELECT * FROM orders");

  await client.query("COMMIT");
} finally {
  await resetTenantContext(client); // Always reset before release
  client.release();
}
```

:::danger
Always call `resetTenantContext()` before releasing a connection. Failure to do so can leak tenant context to the next request that uses this connection.
:::

## Checking RLS Status

```typescript
import { isRLSEnabled } from "@stratum/db-adapters";

const enabled = await isRLSEnabled(client, "orders");
console.log(`RLS on orders: ${enabled}`); // true or false
```

## Removing RLS

```typescript
import { dropPolicy, disableRLS } from "@stratum/db-adapters";

await dropPolicy(client, "orders");
await disableRLS(client, "orders");
```

## Security Considerations

### FORCE ROW LEVEL SECURITY

`enableRLS()` always sets `FORCE ROW LEVEL SECURITY`. Without FORCE, the table owner role bypasses RLS policies entirely. With FORCE, even the owner must pass through the policy.

### BYPASSRLS Check

The Stratum migration checks that the application database role does not have `BYPASSRLS`. If it does:

```sql
ALTER ROLE your_app_role NOBYPASSRLS;
```

### Table Name Validation

All DDL operations validate table names against `/^[a-zA-Z_][a-zA-Z0-9_]*$/` to prevent SQL injection. This is necessary because PostgreSQL does not support parameterized identifiers in DDL.

### Transaction-Local Context

The `set_config()` call uses `true` as the third parameter, making the setting transaction-local:

```sql
SELECT set_config('app.current_tenant_id', $1, true);
```

This means the setting automatically disappears when the transaction ends, providing an additional safety net.
