---
sidebar_position: 7
title: Isolation Strategies
---

# Isolation Strategies

Stratum supports three levels of tenant data isolation, each offering a different trade-off between infrastructure complexity, isolation strength, and operational overhead. The strategy is set per tenant at creation time and cannot be changed after the fact.

## Choosing a Strategy

| Strategy | Boundary | Pool | Best For |
|----------|----------|------|----------|
| `SHARED_RLS` | Row (RLS policy) | Shared | High tenant count, shared infrastructure, cost efficiency |
| `SCHEMA_PER_TENANT` | PostgreSQL schema | Shared | Logical isolation without database proliferation |
| `DB_PER_TENANT` | Dedicated database | Per-tenant LRU | Compliance, maximum isolation, noisy-neighbour avoidance |

---

## SHARED_RLS

All tenants share the same PostgreSQL tables. Row-Level Security policies enforce that each query sees only its own tenant's rows.

### How It Works

Every tenant-scoped table has an RLS policy:

```sql
CREATE POLICY tenant_isolation ON orders
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
```

The db-adapter sets this variable in a transaction-local `set_config()` call before executing any query, then resets it on connection release.

### Creating a SHARED_RLS Tenant

```typescript
import { Pool } from "pg";
import { Stratum } from "@stratum/lib";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const stratum = new Stratum({ pool });

const tenant = await stratum.createTenant({
  name: "Acme Corp",
  slug: "acme_corp",
  isolation_strategy: "SHARED_RLS",
});
```

Via the REST API:

```bash
curl -X POST http://localhost:3001/api/v1/tenants \
  -H "Content-Type: application/json" \
  -H "X-API-Key: sk_live_..." \
  -d '{
    "name": "Acme Corp",
    "slug": "acme_corp",
    "isolation_strategy": "SHARED_RLS"
  }'
```

### Using the RawAdapter

```typescript
import { Pool } from "pg";
import { RawAdapter } from "@stratum/db-adapters";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new RawAdapter(pool);

// Every query is wrapped in: BEGIN → set_config → query → COMMIT → RESET
const result = await adapter.query(tenant.id, "SELECT * FROM orders");
```

---

## SCHEMA_PER_TENANT

Each tenant gets a dedicated PostgreSQL schema named `tenant_{slug}`. Tables are replicated from the public schema structure. Queries are routed by setting `search_path` within each transaction.

### How It Works

```
public schema        → Stratum system tables (tenants, configs, etc.)
tenant_acme_corp     → Acme Corp's application tables
tenant_northstar     → NorthStar's application tables
```

No RLS policies are required — the schema boundary enforces isolation.

### Creating a SCHEMA_PER_TENANT Tenant

```typescript
const tenant = await stratum.createTenant({
  name: "Acme Corp",
  slug: "acme_corp",
  isolation_strategy: "SCHEMA_PER_TENANT",
});
// Schema "tenant_acme_corp" is created automatically
```

### Managing Schemas

```typescript
import { SchemaManager } from "@stratum/db-adapters";

const manager = new SchemaManager(pool);

// Manually create a schema (done automatically by createTenant)
await manager.createSchema("acme_corp");

// List all tenant schemas
const schemas = await manager.listSchemas();
// → ["tenant_acme_corp", "tenant_northstar"]

// Drop a schema (run after archiving a tenant)
await manager.dropSchema("acme_corp");
```

### Querying with SchemaRawAdapter

```typescript
import { SchemaRawAdapter } from "@stratum/db-adapters";

const adapter = new SchemaRawAdapter(pool);

// Routes to tenant_acme_corp.orders via SET LOCAL search_path
const result = await adapter.query("acme_corp", "SELECT * FROM orders");
```

### Querying with SchemaPrismaAdapter

```typescript
import { PrismaClient } from "@prisma/client";
import { withSchemaIsolation } from "@stratum/db-adapters";
import { getTenantContext } from "@stratum/sdk";

const prisma = new PrismaClient();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const tenantPrisma = withSchemaIsolation(
  prisma,
  () => getTenantContext().tenant_slug,
  pool,
);

// Queries are routed to the current tenant's schema
const orders = await tenantPrisma.order.findMany();
```

---

## DB_PER_TENANT

Each tenant gets a dedicated PostgreSQL database named `stratum_tenant_{slug}`. A `DatabasePoolManager` maintains an LRU cache of connection pools, creating new pools on demand and evicting idle ones.

### How It Works

```
stratum                      → Stratum control plane database
stratum_tenant_acme_corp     → Acme Corp's database
stratum_tenant_northstar     → NorthStar's database
```

Full database-level isolation: separate WAL, separate vacuuming, separate connection limits.

### Creating a DB_PER_TENANT Tenant

```typescript
const tenant = await stratum.createTenant({
  name: "Acme Corp",
  slug: "acme_corp",
  isolation_strategy: "DB_PER_TENANT",
});
// Database "stratum_tenant_acme_corp" is created automatically
```

:::note
Database creation runs outside a transaction — this is a PostgreSQL requirement (`CREATE DATABASE` cannot be executed within a transaction block).
:::

### Managing the Pool

```typescript
import { DatabasePoolManager } from "@stratum/db-adapters";

const poolManager = new DatabasePoolManager({
  baseConnectionString: process.env.DATABASE_URL,
  maxPools: 50,          // evict least-recently-used pool after 50 entries
  idleTimeoutMs: 300000, // 5 minutes — evict pools inactive longer than this
});

// Get or create a pool for a tenant
const tenantPool = await poolManager.getPool("acme_corp");
const result = await tenantPool.query("SELECT * FROM orders");

// Graceful shutdown — drain all pools
await poolManager.drainAll();
```

### Querying with DatabaseRawAdapter

```typescript
import { DatabaseRawAdapter } from "@stratum/db-adapters";

const adapter = new DatabaseRawAdapter(poolManager);

// Routes to stratum_tenant_acme_corp automatically
const result = await adapter.query("acme_corp", "SELECT * FROM orders");
```

### Querying with DatabasePrismaAdapter

```typescript
import { withDatabaseIsolation } from "@stratum/db-adapters";
import { getTenantContext } from "@stratum/sdk";

const tenantPrisma = withDatabaseIsolation(
  (connectionString) => new PrismaClient({ datasources: { db: { url: connectionString } } }),
  () => getTenantContext().tenant_slug,
  poolManager,
);

const orders = await tenantPrisma.order.findMany();
```

### Managing Databases

```typescript
import { DatabaseManager } from "@stratum/db-adapters";

const manager = new DatabaseManager(process.env.DATABASE_URL);

// Create a database outside any transaction
await manager.createDatabase("acme_corp");
// → stratum_tenant_acme_corp

// Drop after tenant archival
await manager.dropDatabase("acme_corp");
```

---

## Migration Considerations

### Adding a Strategy to Existing Tenants

The isolation strategy is set at tenant creation. To migrate an existing tenant from `SHARED_RLS` to `SCHEMA_PER_TENANT`:

1. Create the schema: `manager.createSchema(tenant.slug)`
2. Migrate data from the shared tables into the new schema
3. Update the tenant record's `isolation_strategy` field directly in the database
4. Switch your adapter to `SchemaRawAdapter` for that tenant

Automated strategy migration tooling is planned for v2.0.

### Migration Files

| Migration | Change |
|-----------|--------|
| `001_initial` | Initial schema, `SHARED_RLS` only |
| `002_schema_per_tenant` | Allows `SCHEMA_PER_TENANT` in `isolation_strategy` constraint |
| `003_db_per_tenant` | Allows `DB_PER_TENANT`, adds `connection_config` column |
| `004_webhooks` | Adds webhook tables |

Migrations run automatically on control plane startup.
