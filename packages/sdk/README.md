# @stratum-hq/sdk

HTTP client, LRU cache, and Express/Fastify middleware for the [Stratum](https://github.com/stratum-hq/Stratum) control plane. Resolves tenant context from incoming requests and attaches it to the request object.

## Installation

```bash
npm install @stratum-hq/sdk @stratum-hq/core
```

## Quick Start

```typescript
import { stratum } from "@stratum-hq/sdk";

const s = stratum({
  controlPlaneUrl: "http://localhost:3001",
  apiKey: "sk_live_your_key",
});

// Express
app.use(s.middleware({ jwtClaimPath: "tenant_id" }));

// Fastify
app.register(s.plugin({ jwtClaimPath: "tenant_id" }));

// Direct client access
const ctx = await s.client.resolveTenant("tenant-uuid");
```

Prefer the pieces individually? Import them directly:

```typescript
import { StratumClient, expressMiddleware } from "@stratum-hq/sdk";

const client = new StratumClient({
  controlPlaneUrl: "http://localhost:3001",
  apiKey: "sk_live_your_key",
  cache: { enabled: true, ttlMs: 60000, maxSize: 100 },
});

app.use(expressMiddleware(client, {
  jwtClaimPath: "tenant_id",
  jwtSecret: process.env.JWT_SECRET,
  headerName: "X-Tenant-ID",
}));

app.get("/data", (req, res) => {
  res.json({ tenantId: req.tenant.tenant_id, config: req.tenant.resolved_config });
});
```

## Features

- **`StratumClient`** — HTTP client for the control plane API (`resolveTenant`, `getTenantTree`, `createTenant`, `createWebhook`, `listRegions`, …) with a built-in LRU cache. Mutations made through the client invalidate affected entries (a move clears the whole cache); changes made elsewhere, such as a suspension or a config or permission change, are picked up when the entry expires, so the cache TTL (`cache.ttlMs`, default 60s) bounds how stale a context can be.
- **`expressMiddleware` / `fastifyPlugin`** — resolve the tenant from a JWT claim, `X-Tenant-ID` header, or custom resolvers (tried in that order), then populate `req.tenant`.
- **AsyncLocalStorage context** — `getTenantContext()` and `runWithTenantContext()` make the resolved context available to services that never see the request object.
- **Custom resolvers** — supply async functions (e.g. subdomain- or query-based) via the `resolvers` option.

JWT resolution activates only when `jwtSecret` or `jwtVerify` is provided; otherwise Bearer tokens are ignored. When it is active, the verified JWT is the tenant binding: a Bearer token that fails verification is rejected with `401 INVALID_TOKEN`, and the tenant header is not read unless you set `trustTenantHeader: true`. If no tenant is found, the middleware returns `400 MISSING_TENANT`.

`jwtSecret` verifies HS256 tokens with [`jsonwebtoken`](https://www.npmjs.com/package/jsonwebtoken), an optional peer dependency: install it alongside the SDK (`npm install jsonwebtoken`) or pass `jwtVerify` instead. The middleware throws at construction if `jwtSecret` is set and `jsonwebtoken` cannot be loaded.

`headerName` replaces the default `X-Tenant-ID` header: when it is set, only that header is read.

## Error Handling

The SDK throws typed errors from `@stratum-hq/core`:

```typescript
import { TenantNotFoundError, UnauthorizedError } from "@stratum-hq/core";
```

## Links

- Documentation: https://docs.stratum-hq.org/packages/sdk/
- GitHub: https://github.com/stratum-hq/Stratum

## License

MIT © Christian Crank
