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

- **`StratumClient`** — HTTP client for the control plane API (`resolveTenant`, `getTenantTree`, `createTenant`, `createWebhook`, `listRegions`, …) with a built-in LRU cache that auto-invalidates on mutations.
- **`expressMiddleware` / `fastifyPlugin`** — resolve the tenant from a JWT claim, `X-Tenant-ID` header, or custom resolvers (tried in that order), then populate `req.tenant`.
- **AsyncLocalStorage context** — `getTenantContext()` and `runWithTenantContext()` make the resolved context available to services that never see the request object.
- **Custom resolvers** — supply async functions (e.g. subdomain- or query-based) via the `resolvers` option.

JWT resolution activates only when `jwtSecret` or `jwtVerify` is provided; otherwise Bearer tokens are ignored. If no tenant is found, the middleware returns `400 MISSING_TENANT`.

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
