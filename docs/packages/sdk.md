# @stratum/sdk

Node.js SDK for integrating Stratum multi-tenancy into your application.

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

See the full [SDK Integration Guide](../guides/sdk-integration.md) for detailed usage.

## Components

### StratumClient

HTTP client for the control plane API with built-in LRU caching.

```typescript
import { StratumClient } from "@stratum/sdk";

const client = new StratumClient({
  controlPlaneUrl: "http://localhost:3001",
  apiKey: "sk_live_your_key",
  cache: { enabled: true, ttlMs: 60000, maxSize: 100 },
});
```

**Methods:**

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

### Express Middleware

```typescript
import { expressMiddleware } from "@stratum/sdk";

app.use(expressMiddleware(client, options));
// req.tenant is now available
```

### Fastify Plugin

```typescript
import { fastifyPlugin } from "@stratum/sdk";

app.register(fastifyPlugin, { client, ...options });
// request.tenant is now available
```

### Middleware Options

```typescript
interface MiddlewareOptions {
  jwtClaimPath?: string;         // JWT claim path for tenant ID
  jwtSecret?: string;            // JWT verification secret
  jwtVerify?: (token: string) => Record<string, unknown> | null;
  headerName?: string;           // Default: "X-Tenant-ID"
  resolvers?: TenantResolver[];  // Custom resolution functions
  onError?: (err: Error, req: unknown) => void;
}
```

### Tenant Context (AsyncLocalStorage)

```typescript
import { getTenantContext, runWithTenantContext } from "@stratum/sdk";

// Read context (throws if none)
const ctx = getTenantContext();

// Run code with explicit context
await runWithTenantContext(tenantContext, async () => {
  const ctx = getTenantContext(); // available here
});
```

### LRU Cache

Built-in Map-based LRU cache with TTL expiration:

- Default max size: 100 entries
- Default TTL: 60 seconds (from `@stratum/core` constant)
- Auto-invalidated on mutations
- Configurable or disableable via client options

## Tenant Resolution Order

1. **JWT** — Bearer token, extracts claim at `jwtClaimPath`
2. **Header** — `X-Tenant-ID` (or custom `headerName`)
3. **Custom resolvers** — tried in order, first non-null wins

If no tenant ID is resolved, returns `400 MISSING_TENANT`.

## Error Types

```typescript
import { TenantNotFoundError, UnauthorizedError } from "@stratum/core";
```

| Error | When |
|-------|------|
| `TenantNotFoundError` | Tenant ID doesn't exist |
| `UnauthorizedError` | Invalid API key or token |
