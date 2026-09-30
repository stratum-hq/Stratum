# @stratum-hq/hono

[Hono](https://hono.dev) middleware for [Stratum](https://github.com/stratum-hq/Stratum) — extracts tenant identity from a request and sets up AsyncLocalStorage context for downstream handlers.

## Installation

```bash
npm install @stratum-hq/hono @stratum-hq/sdk @stratum-hq/core hono
```

## Quick Start

```typescript
import { Hono } from "hono";
import { stratumMiddleware } from "@stratum-hq/hono";
import { getTenantContext } from "@stratum-hq/sdk";

const app = new Hono();

app.use("*", stratumMiddleware({
  header: "x-tenant-id",
  // Required for header mode: a client can set any header, so only enable this
  // when a gateway you control sets x-tenant-id and strips any client copy.
  trustTenantHeader: true,
  // Optional: fetch the full tenant context (ancestry, config, permissions)
  resolve: async (tenantId) => sdkClient.resolveTenant(tenantId),
}));

app.get("/users", (c) => {
  const tenantId = c.get("tenantId");        // raw ID set by the middleware
  const ctx = getTenantContext();             // full context via AsyncLocalStorage
  return c.json({ tenantId, config: ctx.resolved_config });
});
```

## Options

`stratumMiddleware(options)` extracts the tenant ID from exactly one source, in this precedence:

| Option | Behavior |
|--------|----------|
| `jwtClaim` | Read the claim from Hono's `jwtPayload` context variable |
| `pathParam` | Read a URL path parameter (`c.req.param(name)`) |
| `header` | Read a request header (default: `x-tenant-id`). Requires `trustTenantHeader: true` |
| `trustTenantHeader` | Allow header mode. Without it, and without `jwtClaim` or `pathParam`, `stratumMiddleware` throws at construction (default: `false`) |
| `resolve` | Optional callback `(tenantId) => TenantContext` to populate ancestry, config, and permissions |

If no tenant ID is found, the middleware responds with `400 { error: "Missing tenant ID" }`. If `resolve` rejects with a tenant error from `@stratum-hq/core`, for example from `StratumClient.resolveTenant`, the middleware responds with 404 `TENANT_NOT_FOUND`, 403 `TENANT_SUSPENDED`, 410 `TENANT_ARCHIVED`, or 403 `FORBIDDEN`. A control plane timeout gets 504 `CONTROL_PLANE_TIMEOUT`. An `UnauthorizedError` for the SDK's own API key gets 500 `CONTROL_PLANE_AUTH_FAILED` and a `console.error` line. Other errors go to the Hono error handler. Without a `resolve` callback the context is a placeholder (empty config/permissions) — provide `resolve` for real tenant data.

## Features

- Tenant extraction from header, JWT claim, or path parameter
- Binds tenant context via `runWithTenantContext` so downstream handlers can call `getTenantContext()`
- Lightweight — structural types only, no heavy dependencies

## Links

- Documentation: https://docs.stratum-hq.org/packages/hono/
- GitHub: https://github.com/stratum-hq/Stratum

## License

MIT © Christian Crank
