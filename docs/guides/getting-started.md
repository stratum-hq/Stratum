# Getting Started

This guide walks you through setting up Stratum locally and integrating it into your application.

## Installation

### 1. Start PostgreSQL

Using Docker (recommended):

```bash
docker-compose up db -d
```

Or install locally:

```bash
brew install postgresql@16
brew services start postgresql@16
createdb stratum
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Build

```bash
npm run build
```

### 4. Start the Control Plane

```bash
node packages/control-plane/dist/index.js
```

This automatically runs database migrations on first start. The API will be available at `http://localhost:3001` (or the `PORT` env var).

### 5. Create Your First API Key

```bash
curl -X POST http://localhost:3001/api/v1/api-keys \
  -H "Content-Type: application/json" \
  -H "X-API-Key: sk_test_bootstrap" \
  -d '{"name": "my-app"}'
```

Save the `plaintext_key` from the response — it's only shown once.

### 6. Create a Tenant

```bash
curl -X POST http://localhost:3001/api/v1/tenants \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY_HERE" \
  -d '{
    "name": "Acme Corp",
    "slug": "acme_corp",
    "isolation_strategy": "SHARED_RLS"
  }'
```

### 7. Create a Child Tenant

```bash
curl -X POST http://localhost:3001/api/v1/tenants \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY_HERE" \
  -d '{
    "name": "Acme West",
    "slug": "acme_west",
    "parent_id": "PARENT_TENANT_ID",
    "isolation_strategy": "SHARED_RLS"
  }'
```

## Integrating the SDK

### Express.js

```bash
npm install @stratum/sdk
```

```typescript
import express from "express";
import { stratum } from "@stratum/sdk";

const app = express();
const s = stratum({
  controlPlaneUrl: "http://localhost:3001",
  apiKey: "YOUR_KEY_HERE",
});

// Add middleware — resolves tenant from JWT or X-Tenant-ID header
app.use(s.middleware());

app.get("/data", (req, res) => {
  // req.tenant contains the full TenantContext
  console.log(req.tenant.tenant_id);
  console.log(req.tenant.resolved_config);
  console.log(req.tenant.resolved_permissions);
  res.json({ tenant: req.tenant.tenant_id });
});
```

### Fastify

```typescript
import Fastify from "fastify";
import { stratum } from "@stratum/sdk";

const app = Fastify();
const s = stratum({
  controlPlaneUrl: "http://localhost:3001",
  apiKey: "YOUR_KEY_HERE",
});

app.register(s.plugin());

app.get("/data", (request, reply) => {
  // request.tenant contains the full TenantContext
  reply.send({ tenant: request.tenant.tenant_id });
});
```

### Tenant Resolution Order

The middleware resolves the tenant ID in this order:

1. **JWT claim** — extracts from a JWT Bearer token (configurable claim path)
2. **Header** — reads `X-Tenant-ID` header
3. **Custom resolvers** — your own resolution logic

```typescript
app.use(s.middleware({
  // JWT options
  jwtClaimPath: "tenant_id",          // path in JWT payload
  jwtSecret: "your-jwt-secret",       // optional: verify signature
  jwtVerify: (token) => { ... },      // optional: custom verify function

  // Custom resolvers
  resolvers: [
    {
      resolve: async (req) => {
        // Extract tenant from subdomain, query param, etc.
        return req.hostname.split(".")[0];
      },
    },
  ],

  // Error handling
  onError: (err, req) => {
    console.error("Tenant resolution failed:", err);
  },
}));
```

## Database Integration

### Raw PostgreSQL (pg)

```typescript
import { Pool } from "pg";
import { createTenantPool } from "@stratum/db-adapters";
import { getTenantContext } from "@stratum/sdk";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const tenantPool = createTenantPool(pool, () => getTenantContext().tenant_id);

// Queries are automatically scoped to the current tenant via RLS
const result = await tenantPool.query("SELECT * FROM orders");
```

### Prisma

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

// All queries scoped to current tenant
const orders = await tenantPrisma.order.findMany();
```

### Setting Up RLS on Your Tables

```typescript
import { Pool } from "pg";
import { migrateTable } from "@stratum/db-adapters";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();

try {
  await client.query("BEGIN");
  // Adds tenant_id column, enables RLS, creates isolation policy
  await migrateTable(client, "your_table_name");
  await client.query("COMMIT");
} finally {
  client.release();
}
```

## React Integration

```bash
npm install @stratum/react
```

```tsx
import { StratumProvider, useStratum } from "@stratum/react";
import { TenantSwitcher, TenantTree, ConfigEditor } from "@stratum/react";

function App() {
  return (
    <StratumProvider
      controlPlaneUrl="http://localhost:3001"
      apiKey="YOUR_KEY_HERE"
    >
      <TenantSwitcher />
      <TenantTree />
      <ConfigEditor />
      <Dashboard />
    </StratumProvider>
  );
}

function Dashboard() {
  const { currentTenant, tenantContext, loading } = useStratum();

  if (loading) return <div>Loading...</div>;
  if (!currentTenant) return <div>Select a tenant</div>;

  return (
    <div>
      <h1>{currentTenant.name}</h1>
      <pre>{JSON.stringify(tenantContext?.resolved_config, null, 2)}</pre>
    </div>
  );
}
```

## Running the Demo

The demo app showcases a full MSSP hierarchy with security events, config inheritance, and permission delegation.

```bash
# Start everything
docker-compose up db -d
node packages/control-plane/dist/index.js   # Terminal 1
npx tsx packages/demo/api/src/seed.ts        # Terminal 2 (one-time)
npm run dev --workspace=@stratum/demo        # Terminal 3
```

Open http://localhost:3300 to explore:
- **Dashboard** — security events filtered by tenant (RLS-enforced)
- **Tenants** — hierarchical tree view with tenant switching
- **Config** — config and permission editors with inheritance visualization
