---
sidebar_position: 3
title: Control Plane + SDK
---

# Control Plane + SDK Integration

Run the control plane as a service and use the SDK for tenant-aware middleware in your application.

## When to Use

- Polyglot stacks (any language can call the HTTP API)
- Service-oriented architectures
- Need the React admin UI
- Want Swagger documentation and OpenAPI spec

## Architecture

```
Your App (Express/Fastify)
  └── @stratum/sdk middleware
        └── HTTP calls to control plane
              └── @stratum/lib → PostgreSQL
```

## Setup

### 1. Start the Control Plane

```bash
# Build
npm run build --workspace=@stratum/control-plane

# Run (auto-migrates on first start)
DATABASE_URL=postgres://user:pass@localhost:5432/stratum \
  JWT_SECRET=your-secret \
  node packages/control-plane/dist/index.js
```

### 2. Install the SDK

```bash
npm install @stratum/sdk @stratum/core
```

### 3. Create an API Key

```bash
curl -X POST http://localhost:3001/api/v1/api-keys \
  -H "Content-Type: application/json" \
  -H "X-API-Key: sk_test_bootstrap" \
  -d '{"name": "my-app"}'
```

## Express Integration

```typescript
import express from "express";
import { StratumClient, expressMiddleware } from "@stratum/sdk";

const app = express();
const client = new StratumClient({
  controlPlaneUrl: "http://localhost:3001",
  apiKey: "sk_live_your_key_here",
  cache: { enabled: true, ttlMs: 60000, maxSize: 100 },
});

// Add middleware — resolves tenant from JWT or header
app.use(expressMiddleware(client, {
  jwtClaimPath: "tenant_id",
  jwtSecret: process.env.JWT_SECRET,
  headerName: "X-Tenant-ID",
}));

app.get("/data", (req, res) => {
  // req.tenant is fully populated
  console.log(req.tenant.tenant_id);
  console.log(req.tenant.resolved_config);
  console.log(req.tenant.resolved_permissions);
  res.json({ tenant: req.tenant.tenant_id });
});

app.listen(3000);
```

## Fastify Integration

```typescript
import Fastify from "fastify";
import { StratumClient, fastifyPlugin } from "@stratum/sdk";

const app = Fastify();
const client = new StratumClient({
  controlPlaneUrl: "http://localhost:3001",
  apiKey: "sk_live_your_key_here",
});

app.register(fastifyPlugin, {
  client,
  jwtClaimPath: "tenant_id",
  jwtSecret: process.env.JWT_SECRET,
});

app.get("/data", (request, reply) => {
  const ctx = request.tenant;
  reply.send({ tenantId: ctx.tenant_id });
});

app.listen({ port: 3000 });
```

## Convenience Factory

The `stratum()` factory simplifies setup:

```typescript
import { stratum } from "@stratum/sdk";

const s = stratum({
  controlPlaneUrl: "http://localhost:3001",
  apiKey: "sk_live_your_key_here",
});

// Express
app.use(s.middleware({ jwtClaimPath: "tenant_id" }));

// Fastify
app.register(s.plugin({ jwtClaimPath: "tenant_id" }));

// Direct client
const ctx = await s.client.resolveTenant("tenant-uuid");
```

## Tenant Resolution

The middleware resolves tenant ID in this order:

1. **JWT Bearer token** — extracts claim at `jwtClaimPath` (supports nested paths like `org.tenant_id`)
2. **Header** — reads `X-Tenant-ID` (or custom `headerName`)
3. **Custom resolvers** — your own async functions, tried in order

```typescript
app.use(expressMiddleware(client, {
  resolvers: [
    {
      // Resolve from subdomain
      resolve: async (req) => {
        const subdomain = req.hostname.split(".")[0];
        return subdomain !== "www" ? subdomain : null;
      },
    },
    {
      // Resolve from query parameter
      resolve: async (req) => req.query.tenant_id ?? null,
    },
  ],
}));
```

## AsyncLocalStorage Context

Access tenant context anywhere in your call stack, not just in route handlers:

```typescript
import { getTenantContext } from "@stratum/sdk";

// In a service layer (no request object available)
function getOrdersForCurrentTenant() {
  const ctx = getTenantContext(); // throws if no context
  return db.query("SELECT * FROM orders WHERE tenant_id = $1", [ctx.tenant_id]);
}

// In a utility
function checkPermission(key: string): boolean {
  const ctx = getTenantContext();
  return ctx.resolved_permissions[key]?.value === true;
}
```

## Caching

The SDK client caches tenant context resolution to minimize HTTP calls:

```typescript
const client = new StratumClient({
  controlPlaneUrl: "http://localhost:3001",
  apiKey: "sk_live_your_key",
  cache: {
    enabled: true,   // default: true
    ttlMs: 60000,    // default: 60 seconds
    maxSize: 100,    // default: 100 entries
  },
});

// Manual cache management
client.invalidateCache("tenant-id"); // Invalidate one entry
client.clearCache();                  // Clear everything
```

Cache is automatically invalidated when you call mutation methods (`updateTenant`, `moveTenant`, `archiveTenant`, `deleteTenant`).

## Client Methods

```typescript
// Tenant CRUD
const tenant = await client.createTenant({ name: "Acme", slug: "acme" });
const tenant = await client.getTenant("tenant-id");
const tenant = await client.updateTenant("tenant-id", { name: "New Name" });
await client.deleteTenant("tenant-id");

// Tree navigation
const tenants = await client.getTenantTree();              // all tenants
const descendants = await client.getTenantTree("root-id"); // subtree

// Move & archive
await client.moveTenant("tenant-id", { new_parent_id: "new-parent" });
await client.archiveTenant("tenant-id");

// Full context resolution (cached)
const ctx = await client.resolveTenant("tenant-id");
```

## Error Handling

```typescript
import { TenantNotFoundError, UnauthorizedError } from "@stratum/core";

try {
  await client.resolveTenant("bad-id");
} catch (err) {
  if (err instanceof TenantNotFoundError) {
    // 404 — tenant doesn't exist
  }
  if (err instanceof UnauthorizedError) {
    // 401 — invalid API key
  }
}
```
