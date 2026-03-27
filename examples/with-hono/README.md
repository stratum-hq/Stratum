# Stratum + Hono

Lightweight Hono API server with per-request multi-tenancy via Stratum.

Tenant context is resolved from the `X-Tenant-ID` request header by a custom
Hono middleware. The tenant ID is stored in Hono's typed `Context` variable bag
and consumed by route handlers.

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
PORT=3000
```

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

All `/api/*` routes require an `X-Tenant-ID` header containing a valid tenant UUID.

## Example requests

```bash
# Seed a tenant first (using quickstart.ts or the Stratum CLI)
TENANT_ID="your-tenant-uuid"

# Get tenant info
curl -H "X-Tenant-ID: $TENANT_ID" http://localhost:3000/api/tenant

# Get resolved config (includes inherited values from ancestors)
curl -H "X-Tenant-ID: $TENANT_ID" http://localhost:3000/api/config

# Create a child tenant
curl -X POST http://localhost:3000/api/tenants \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: $TENANT_ID" \
  -d '{"name": "Acme Corp", "slug": "acme_corp", "parent_id": "'$TENANT_ID'"}'
```

## How it works

Hono's `MiddlewareHandler` type is parameterised with `{ Variables: TenantVars }`,
which gives full TypeScript inference for `c.get("tenantId")` in route handlers.
The middleware validates the tenant exists before setting the variable, so handlers
can safely call Stratum methods without extra null checks.
