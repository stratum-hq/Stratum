# Stratum + Express

Express API server with per-request multi-tenancy via Stratum.

Tenant context is resolved from a verified JWT by `@stratum-hq/sdk`'s Express
middleware. The middleware verifies the HS256 bearer token with `jsonwebtoken`
and reads the tenant from the `tenant_id` claim. The full tenant config (with
ancestor inheritance) is available at `/api/config`.

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
STRATUM_CONTROL_PLANE_URL=http://localhost:3001
STRATUM_API_KEY=sk_live_your_key_here
JWT_SECRET=<output of: openssl rand -hex 32>
PORT=3000
```

The server does not start without `JWT_SECRET` and `STRATUM_API_KEY`. Keep
both out of source control.

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
| `GET` | `/api/tenant` | Returns current tenant context |
| `GET` | `/api/config` | Returns resolved config for current tenant |
| `POST` | `/api/tenants` | Creates a child tenant under the caller's tenant |

All `/api/*` routes require an `Authorization: Bearer <token>` header. The token
must verify with `JWT_SECRET` and carry a `tenant_id` claim that holds a valid
tenant UUID.

- A request without a token gets `400 MISSING_TENANT`.
- A token that does not verify gets `401 INVALID_TOKEN`.

## Example requests

Your identity provider or login route issues the token in a real application.
For local testing, sign one with the same secret:

```bash
# Seed a tenant first (using the Stratum CLI or quickstart example)
TENANT_ID="your-tenant-uuid"

TOKEN=$(node -e 'console.log(require("jsonwebtoken").sign({ tenant_id: process.argv[1] }, process.env.JWT_SECRET, { algorithm: "HS256", expiresIn: "1h" }))' "$TENANT_ID")

# Get tenant context
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/tenant

# Get resolved config
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/config

# Create a child tenant under the tenant in the token
curl -X POST http://localhost:3000/api/tenants \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name": "Acme Corp", "slug": "acme_corp"}'
```

The route reads the parent from the verified token, not from the request body.
A caller can only create tenants below its own tenant.

## When to trust the tenant header

With `jwtSecret` set, the SDK ignores the `X-Tenant-ID` request header. The
verified token is the only tenant binding, so a client cannot select another
tenant by sending a header.

Set `trustTenantHeader: true` only when all of these are true:

- A gateway or service mesh that you control sets `X-Tenant-ID`.
- That gateway removes any `X-Tenant-ID` header that the client sent.
- Clients cannot reach this server except through that gateway.

```ts
app.use("/api", sdk.middleware({ jwtSecret, trustTenantHeader: true }));
```
