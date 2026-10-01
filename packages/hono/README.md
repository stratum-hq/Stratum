# @stratum-hq/hono

[Hono](https://hono.dev) middleware for [Stratum](https://github.com/stratum-hq/Stratum). It extracts tenant identity from a request and sets up AsyncLocalStorage context for downstream handlers.

Read the documentation at [docs.stratum-hq.org/packages/hono](https://docs.stratum-hq.org/packages/hono/).

## Installation

```bash
npm install @stratum-hq/hono @stratum-hq/sdk @stratum-hq/core hono
```

## Quick Start

Read the tenant from a claim of a verified JWT:

```typescript
import { Hono } from "hono";
import { jwt } from "hono/jwt";
import { stratumMiddleware } from "@stratum-hq/hono";
import { getTenantContext } from "@stratum-hq/sdk";

const app = new Hono();

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  throw new Error("JWT_SECRET is required to verify bearer tokens.");
}

// hono/jwt rejects a missing or invalid bearer token with 401 and stores the
// verified claims as jwtPayload. Register it before stratumMiddleware.
app.use("*", jwt({ secret: jwtSecret, alg: "HS256" }));

app.use("*", stratumMiddleware({
  // Read the tenant from the verified `tenant_id` claim
  jwtClaim: "tenant_id",
  // Optional: fetch the full tenant context (ancestry, config, permissions)
  resolve: async (tenantId) => sdkClient.resolveTenant(tenantId),
}));

app.get("/users", (c) => {
  const tenantId = c.get("tenantId");        // raw ID set by the middleware
  const ctx = getTenantContext();             // full context via AsyncLocalStorage
  return c.json({ tenantId, config: ctx.resolved_config });
});
```

`stratumMiddleware` does not verify a token itself; `jwtClaim` reads the `jwtPayload` that Hono's JWT middleware sets.

### Client-controlled sources

`pathParam` and `header` both take the tenant ID from the request as the client sent it, so any client can name another tenant. Use them only when something you control authorizes the caller for that tenant (for example a later middleware that compares it with a claim of the verified token). Path parameter mode therefore requires `trustPathParam: true`. Header mode requires `trustTenantHeader: true`, which is appropriate only when a gateway you control sets the header, removes any client copy, and is the only way to reach the server:

```typescript
// Your application authorizes the caller for the tenant in the path.
app.use("/tenants/:tenantId/*", stratumMiddleware({ pathParam: "tenantId", trustPathParam: true }));

app.use("*", stratumMiddleware({ header: "x-tenant-id", trustTenantHeader: true }));
```

## Options

`stratumMiddleware(options)` extracts the tenant ID from exactly one source, in this precedence:

| Option | Behavior |
|--------|----------|
| `jwtClaim` | Read the claim from Hono's `jwtPayload` context variable |
| `pathParam` | Read a URL path parameter (`c.req.param(name)`). Requires `trustPathParam: true`. Client-controlled: authorize the caller for that tenant separately |
| `header` | Read a request header (default: `x-tenant-id`). Requires `trustTenantHeader: true` |
| `trustPathParam` | Allow path parameter mode. Without it, `stratumMiddleware` throws at construction when `pathParam` is set and `jwtClaim` is not (default: `false`) |
| `trustTenantHeader` | Allow header mode. Without it, and without `jwtClaim` or `pathParam`, `stratumMiddleware` throws at construction (default: `false`) |
| `resolve` | Optional callback `(tenantId) => TenantContext` to populate ancestry, config, and permissions |

If no tenant ID is found, the middleware responds with `400 { error: "Missing tenant ID" }`. If `resolve` rejects with a tenant error from `@stratum-hq/core`, for example from `StratumClient.resolveTenant`, the middleware responds with 404 `TENANT_NOT_FOUND`, 403 `TENANT_SUSPENDED`, 410 `TENANT_ARCHIVED`, or 403 `FORBIDDEN`. A control plane timeout gets 504 `CONTROL_PLANE_TIMEOUT`. An `UnauthorizedError` for the SDK's own API key gets 500 `CONTROL_PLANE_AUTH_FAILED` and a `console.error` line. Other errors go to the Hono error handler. Without a `resolve` callback the context is a placeholder (empty config/permissions); provide `resolve` for real tenant data.

## Features

- Tenant extraction from a verified JWT claim, a path parameter, or a trusted-gateway header
- Binds tenant context via `runWithTenantContext` so downstream handlers can call `getTenantContext()`
- Lightweight: structural types only, no heavy dependencies

## Links

- Documentation: https://docs.stratum-hq.org/packages/hono/
- GitHub: https://github.com/stratum-hq/Stratum

## License

MIT © Christian Crank
