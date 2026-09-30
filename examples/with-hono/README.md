# Stratum + Hono

Lightweight Hono API server with per-request multi-tenancy via Stratum.

Tenant context is resolved from a verified JWT. Hono's built-in JWT middleware
verifies the bearer token, then `stratumMiddleware` from `@stratum-hq/hono`
reads the tenant from the token's `tenant_id` claim. The tenant ID is stored in
Hono's typed `Context` variable bag and consumed by route handlers.

## Prerequisites

- Node.js 20+
- PostgreSQL 15+

## Setup

```bash
npm install
```

Create a `.env` file (or export these vars):

```env
DATABASE_URL=postgres://user:pass@localhost:5432/mydb
JWT_SECRET=<output of: openssl rand -hex 32>
PORT=3000
```

The server does not start without `JWT_SECRET`. Keep the secret out of source
control.

## Run

**Development (with hot reload):**
```bash
npm run dev
```

**Production:**
```bash
npm run build
npm start
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check (no auth required) |
| `GET` | `/api/tenant` | Returns current tenant node |
| `GET` | `/api/config` | Returns resolved config for current tenant |
| `POST` | `/api/tenants` | Creates a new tenant |

All `/api/*` routes require an `Authorization: Bearer <token>` header. The token
must verify with `JWT_SECRET` and carry a `tenant_id` claim that holds a valid
tenant UUID.

- A missing or invalid token gets `401`.
- A valid token without a `tenant_id` claim gets `400`.
- A `tenant_id` that names no tenant gets `404 TENANT_NOT_FOUND`.

## Example requests

Your identity provider or login route issues the token in a real application.
For local testing, sign one with the same secret:

```bash
# Seed a tenant first (using quickstart.ts or the Stratum CLI)
TENANT_ID="your-tenant-uuid"

TOKEN=$(node --input-type=module -e 'import { sign } from "hono/jwt"; console.log(await sign({ tenant_id: process.argv[1], exp: Math.floor(Date.now() / 1000) + 3600 }, process.env.JWT_SECRET, "HS256"))' "$TENANT_ID")

# Get tenant info
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/tenant

# Get resolved config (includes inherited values from ancestors)
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/config

# Create a child tenant
curl -X POST http://localhost:3000/api/tenants \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name": "Acme Corp", "slug": "acme_corp", "parent_id": "'$TENANT_ID'"}'
```

## How it works

1. `jwt({ secret, alg: "HS256" })` from `hono/jwt` verifies the token. It
   stores the claims in the `jwtPayload` context variable.
2. `stratumMiddleware({ jwtClaim: "tenant_id", resolve })` reads the tenant ID
   from `jwtPayload` only. It sets `c.get("tenantId")` and runs the rest of the
   request inside the tenant's AsyncLocalStorage context.
3. The `resolve` callback loads the tenant, its resolved config and its
   permissions from Stratum. An unknown tenant throws `TenantNotFoundError`,
   which `app.onError` maps to `404`.

Hono's `Hono<{ Variables: TenantVars }>` type gives full TypeScript inference
for `c.get("tenantId")` in route handlers.

## When to trust the tenant header

`stratumMiddleware` can read the tenant from a request header instead
(`stratumMiddleware({ header: "x-tenant-id" })`). A client can set any header,
so use this only when all of these are true:

- A gateway or service mesh that you control sets the header.
- That gateway removes any copy of the header that the client sent.
- Clients cannot reach this server except through that gateway.
