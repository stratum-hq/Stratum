# @stratum-hq/sdk

HTTP client, LRU cache, and Express/Fastify middleware for the [Stratum](https://github.com/stratum-hq/Stratum) control plane. Resolves tenant context from incoming requests and attaches it to the request object.

## Installation

```bash
npm install @stratum-hq/sdk @stratum-hq/core jsonwebtoken
```

## Quick Start

```typescript
import { stratum } from "@stratum-hq/sdk";

const s = stratum({
  controlPlaneUrl: "http://localhost:3001",
  apiKey: "sk_live_your_key",
});

// The tenant binding comes from a signed token, so the server does not start
// without the key that verifies it. Without jwtSecret, the middleware reads
// the tenant from the X-Tenant-ID header instead.
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  throw new Error("JWT_SECRET is required to verify bearer tokens.");
}

// Express
app.use(s.middleware({ jwtClaimPath: "tenant_id", jwtSecret }));

// Fastify
app.register(s.plugin({ jwtClaimPath: "tenant_id", jwtSecret }));

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

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  throw new Error("JWT_SECRET is required to verify bearer tokens.");
}

app.use(expressMiddleware(client, {
  jwtClaimPath: "tenant_id",
  jwtSecret,
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

## Archive or purge a tenant

`archiveTenant` and `purgeTenant` do different things. Choose the correct one before you call it.

- `archiveTenant(id)` is a soft delete. The tenant row and its data stay in the database, and the archive is reversible.
- `purgeTenant(id)` permanently deletes the tenant and its data (GDPR Article 17). You cannot undo a purge. The API key must have the `admin` scope, and the tenant must have no children. For a tenant with its own schema or database, the control plane also drops that schema or database. Rows in your own tables that share a database with other tenants stay: delete them yourself.

`deleteTenant(id)` is deprecated. It sends the same request as `archiveTenant`, so it does not remove data.

## Error Handling

The SDK throws typed errors from `@stratum-hq/core`:

```typescript
import {
  ForbiddenError,
  RegionInUseError,
  RegionNotActiveError,
  RegionNotFoundError,
  TenantArchivedError,
  TenantNotFoundError,
  TenantSuspendedError,
  UnauthorizedError,
  ValidationError,
  WebhookNotFoundError,
} from "@stratum-hq/core";
```

| Control plane response | Error |
|---|---|
| 400 `VALIDATION_ERROR` | `ValidationError`, with the issues in `details.issues` |
| 400, any other code | `Error`, with the control plane's message |
| 401 | `UnauthorizedError` |
| 403 `TENANT_SUSPENDED` | `TenantSuspendedError` |
| 403, any other code | `ForbiddenError` |
| 404 `TENANT_NOT_FOUND` | `TenantNotFoundError` |
| 404 `WEBHOOK_NOT_FOUND` | `WebhookNotFoundError` |
| 404 `REGION_NOT_FOUND` | `RegionNotFoundError` |
| 404, any other code | `Error`, with the control plane's message |
| 409 `REGION_IN_USE` | `RegionInUseError`, with the region ID in `details.region_id` |
| 409 `REGION_NOT_ACTIVE` | `RegionNotActiveError`, with the region ID in `details.region_id`. Only `POST /api/v1/tenants/{id}/migrate-region` sends this code, and the SDK has no method for that route yet. |
| 410 `TENANT_ARCHIVED` | `TenantArchivedError` |

An API key that is scoped to a tenant gets `ForbiddenError` (403 `FORBIDDEN`) for a descendant that is suspended or archived, not `TenantSuspendedError` or `TenantArchivedError`. An API key without the `admin` scope gets `ForbiddenError` from an admin operation, for example `purgeTenant`.

The middleware answers these tenant errors with 404, 403, or 410, for the caller's tenant and for an impersonation target, and does not call `onError` for them. A control plane timeout gets 504 `CONTROL_PLANE_TIMEOUT`. An `UnauthorizedError` for the SDK's own API key gets 500 `CONTROL_PLANE_AUTH_FAILED` and a `console.error` line. The middleware calls `onError` for these two. Other errors go to your framework's error handler. Other adapters can use the same mapping: import `tenantErrorResponse` and `controlPlaneErrorResponse`.

Each control plane request has a time limit of `timeoutMs` milliseconds (default 10000). A request that takes longer rejects with a `TimeoutError` `DOMException`. The value must be an integer from 1 to 4294967295, or `Infinity` to turn the time limit off. Any other value makes the constructor throw a `RangeError`:

```typescript
const client = new StratumClient({ controlPlaneUrl, apiKey, timeoutMs: 5000 });
```

A timeout does not mean that the operation failed. If `purgeTenant` times out, the purge can still complete. Call `getTenant(id)` to find out.

## Links

- Documentation: https://docs.stratum-hq.org/packages/sdk/
- GitHub: https://github.com/stratum-hq/Stratum

## License

MIT © Christian Crank
