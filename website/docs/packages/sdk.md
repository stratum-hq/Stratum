---
sidebar_position: 4
title: "@stratum/sdk"
---

# @stratum/sdk

Node.js SDK for integrating Stratum multi-tenancy into your application via HTTP.

## Installation

```bash
npm install @stratum/sdk @stratum/core
```

## Quick Start

```typescript
import { stratum } from "@stratum/sdk";

const s = stratum({
  controlPlaneUrl: "http://localhost:3001",
  apiKey: "sk_live_your_key",
});

// Express
app.use(s.middleware());

// Fastify
app.register(s.plugin());
```

## StratumClient

HTTP client for the control plane API with built-in LRU caching.

```typescript
import { StratumClient } from "@stratum/sdk";

const client = new StratumClient({
  controlPlaneUrl: "http://localhost:3001",
  apiKey: "sk_live_your_key",
  cache: { enabled: true, ttlMs: 60000, maxSize: 100 },
});
```

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `resolveTenant(id)` | `TenantContext` | Resolve full context (cached) |
| `getTenantTree(rootId?)` | `TenantNode[]` | List tenants or subtree |
| `createTenant(input)` | `TenantNode` | Create tenant |
| `getTenant(id)` | `TenantNode` | Get single tenant |
| `updateTenant(id, input)` | `TenantNode` | Update tenant |
| `moveTenant(id, input)` | `TenantNode` | Move in hierarchy |
| `archiveTenant(id)` | `TenantNode` | Soft delete |
| `deleteTenant(id)` | `void` | Delete tenant |
| `invalidateCache(id)` | `void` | Invalidate single cache entry |
| `clearCache()` | `void` | Clear all cached data |

## Express Middleware

```typescript
import { expressMiddleware } from "@stratum/sdk";

app.use(expressMiddleware(client, {
  jwtClaimPath: "tenant_id",
  jwtSecret: process.env.JWT_SECRET,
  headerName: "X-Tenant-ID",
  onError: (err, req) => console.error(err),
}));

app.get("/data", (req, res) => {
  const ctx = req.tenant;
  // ctx.tenant_id, ctx.resolved_config, ctx.resolved_permissions
});
```

## Fastify Plugin

```typescript
import { fastifyPlugin } from "@stratum/sdk";

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

## Tenant Resolution Order

1. **JWT** — Bearer token, extracts claim at `jwtClaimPath`
2. **Header** — `X-Tenant-ID` (or custom `headerName`)
3. **Custom resolvers** — tried in order, first non-null wins

If no tenant ID is resolved, returns `400 MISSING_TENANT`.

### Custom Resolvers

```typescript
expressMiddleware(client, {
  resolvers: [
    {
      resolve: async (req) => {
        const subdomain = req.hostname.split(".")[0];
        return subdomain !== "www" ? subdomain : null;
      },
    },
    {
      resolve: async (req) => req.query.tenant_id ?? null,
    },
  ],
});
```

## AsyncLocalStorage Context

For code that doesn't have access to the request object:

```typescript
import { getTenantContext, runWithTenantContext } from "@stratum/sdk";

function myService() {
  const ctx = getTenantContext(); // throws if no context
  console.log(ctx.tenant_id);
}

await runWithTenantContext(tenantContext, async () => {
  const ctx = getTenantContext(); // available here
});
```

## LRU Cache

Built-in Map-based LRU cache with TTL expiration:

- Default max size: 100 entries
- Default TTL: 60 seconds
- Auto-invalidated on mutations
- Configurable or disableable via client options
