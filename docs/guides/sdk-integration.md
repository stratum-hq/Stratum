# SDK Integration Guide

## Installation

```bash
npm install @stratum/sdk @stratum/core
```

## Client Setup

```typescript
import { StratumClient } from "@stratum/sdk";

const client = new StratumClient({
  controlPlaneUrl: "http://localhost:3001",
  apiKey: "sk_live_your_key_here",
  cache: {
    enabled: true,    // default: true
    ttlMs: 60000,     // default: 60s
    maxSize: 100,     // default: 100 entries
  },
});
```

## Express Middleware

```typescript
import express from "express";
import { StratumClient, expressMiddleware } from "@stratum/sdk";

const app = express();
const client = new StratumClient({
  controlPlaneUrl: "http://localhost:3001",
  apiKey: "sk_live_your_key_here",
});

app.use(expressMiddleware(client, {
  // Tenant resolution options (all optional)
  jwtClaimPath: "tenant_id",
  jwtSecret: process.env.JWT_SECRET,
  headerName: "X-Tenant-ID",        // default
  onError: (err, req) => console.error(err),
}));

app.get("/data", (req, res) => {
  const ctx = req.tenant;
  // ctx.tenant_id
  // ctx.resolved_config
  // ctx.resolved_permissions
  // ctx.isolation_strategy
});
```

## Fastify Plugin

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
```

## Convenience Factory

The `stratum()` factory returns a pre-configured client with middleware/plugin helpers:

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

// Direct client access
const ctx = await s.client.resolveTenant("tenant-uuid");
```

## Tenant Resolution

The middleware resolves tenant ID in this order:

1. **JWT** — extracts tenant ID from a Bearer token claim
2. **Header** — reads `X-Tenant-ID` header
3. **Custom resolvers** — your own async functions

If no tenant ID is found, the middleware returns `400 MISSING_TENANT`.

### JWT Configuration

```typescript
// Option 1: Provide a secret for verification
expressMiddleware(client, {
  jwtClaimPath: "org.tenant_id",  // supports nested paths
  jwtSecret: "your-secret",
});

// Option 2: Custom verify function
expressMiddleware(client, {
  jwtClaimPath: "tenant_id",
  jwtVerify: (token) => {
    // Your verification logic
    // Return decoded payload or null
    return jwt.verify(token, publicKey);
  },
});

// Option 3: No verification (decode only — NOT recommended for production)
expressMiddleware(client, {
  jwtClaimPath: "tenant_id",
});
```

### Custom Resolvers

```typescript
expressMiddleware(client, {
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
});
```

Resolvers are tried in order. The first non-null result wins.

## Context Access

### Via Request Object

```typescript
// Express
app.get("/data", (req, res) => {
  const ctx = req.tenant; // TenantContext
});

// Fastify
app.get("/data", (request, reply) => {
  const ctx = request.tenant; // TenantContext
});
```

### Via AsyncLocalStorage

For code that doesn't have access to the request object (services, repositories):

```typescript
import { getTenantContext } from "@stratum/sdk";

function myService() {
  const ctx = getTenantContext(); // throws if no context
  console.log(ctx.tenant_id);
}
```

### TenantContext Shape

```typescript
interface TenantContext {
  tenant_id: string;
  ancestry_path: string;
  depth: number;
  resolved_config: Record<string, unknown>;
  resolved_permissions: Record<string, ResolvedPermission>;
  isolation_strategy: IsolationStrategy;
}
```

## Client Methods

```typescript
// Resolve full context (cached)
const ctx = await client.resolveTenant("tenant-id");

// CRUD
const tenant = await client.createTenant({ name: "Acme", slug: "acme" });
const tenant = await client.getTenant("tenant-id");
const tenant = await client.updateTenant("tenant-id", { name: "New Name" });
const tenant = await client.moveTenant("tenant-id", { new_parent_id: "parent-id" });
const tenant = await client.archiveTenant("tenant-id");
await client.deleteTenant("tenant-id");

// Tree navigation
const tenants = await client.getTenantTree();            // all tenants
const descendants = await client.getTenantTree("root-id"); // subtree

// Cache management
client.invalidateCache("tenant-id");
client.clearCache();
```

## Error Handling

The SDK throws typed errors from `@stratum/core`:

```typescript
import { TenantNotFoundError, UnauthorizedError } from "@stratum/core";

try {
  await client.resolveTenant("bad-id");
} catch (err) {
  if (err instanceof TenantNotFoundError) {
    // Tenant doesn't exist
  }
  if (err instanceof UnauthorizedError) {
    // Invalid API key
  }
}
```
