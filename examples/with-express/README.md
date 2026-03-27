# Stratum + Express

Express API server with per-request multi-tenancy via Stratum.

Tenant context is resolved from the `X-Tenant-ID` request header using
`@stratum-hq/sdk`'s Express middleware. The full tenant config (with ancestor
inheritance) is available at `/api/config`.

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
| `GET` | `/api/tenant` | Returns current tenant context |
| `GET` | `/api/config` | Returns resolved config for current tenant |
| `POST` | `/api/tenants` | Creates a new tenant |

All `/api/*` routes require an `X-Tenant-ID` header containing a valid tenant UUID.

## Example requests

```bash
# Seed a tenant first (using the Stratum CLI or quickstart example)
TENANT_ID="your-tenant-uuid"

# Get tenant context
curl -H "X-Tenant-ID: $TENANT_ID" http://localhost:3000/api/tenant

# Get resolved config
curl -H "X-Tenant-ID: $TENANT_ID" http://localhost:3000/api/config

# Create a child tenant
curl -X POST http://localhost:3000/api/tenants \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: $TENANT_ID" \
  -d '{"name": "Acme Corp", "slug": "acme_corp", "parent_id": "'$TENANT_ID'"}'
```
