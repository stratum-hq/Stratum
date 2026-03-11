# @stratum/control-plane

REST API server for tenant management, configuration, permissions, and API key lifecycle.

## Running

```bash
# Development
npm run dev --workspace=@stratum/control-plane

# Production
npm run build --workspace=@stratum/control-plane
node packages/control-plane/dist/index.js
```

The server automatically runs database migrations on startup.

## Configuration

All configuration is via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Listen port |
| `DATABASE_URL` | `postgres://stratum:stratum_dev@localhost:5432/stratum` | PostgreSQL connection string |
| `NODE_ENV` | `development` | Environment |
| `JWT_SECRET` | `dev-secret-change-in-production` | JWT signing/verification secret |
| `ALLOWED_ORIGINS` | `http://localhost:3000,http://localhost:3300` | CORS origins (comma-separated) |
| `RATE_LIMIT_MAX` | `100` | Max requests per rate limit window |
| `RATE_LIMIT_WINDOW` | `1 minute` | Rate limit window duration |

## API Endpoints

See the full [API Reference](../api/README.md).

### Summary

- **Tenants**: CRUD, move, archive, tree navigation, context resolution
- **Config**: Get/set/delete with inheritance and lock semantics
- **Permissions**: CRUD with mode (LOCKED/INHERITED/DELEGATED) and revocation
- **API Keys**: Create (display-once) and revoke
- **Health**: `GET /api/v1/health`

### Swagger UI

Available at `/api/docs` when the server is running.

## Services

### tenant-service

Handles tenant CRUD with:
- Advisory locks for concurrent safety
- Cycle detection on moves
- Recursive ancestry path updates on moves
- Soft delete (archive) with child protection

### config-service

Resolves config by walking the ancestor chain root-to-leaf:
- Locked keys block descendant overrides
- Source attribution tracks which tenant set each value
- Batch-loads all entries for the ancestor chain in a single query

### permission-service

Resolves permissions with mode semantics:
- LOCKED: immutable from any descendant
- INHERITED: flows down, overridable
- DELEGATED: flows down, overridable, re-delegatable

Revocation modes: CASCADE (recursive), SOFT (local only), PERMANENT (immutable)

### isolation-service

Manages PostgreSQL RLS setup:
- Validates table names against SQL injection
- Enables RLS + FORCE RLS
- Creates `tenant_isolation` policies

### api-key-service

Full API key lifecycle:
- 256-bit random generation with `sk_live_`/`sk_test_` prefix
- SHA-256 hashed storage (plaintext never stored)
- Validation with `last_used_at` tracking
- Revocation via timestamp

## Database

### Migrations

Located in `src/db/migrations/`. Run automatically on startup via `src/db/migrate.ts`.

The initial migration (`001_init.sql`):
1. Checks for BYPASSRLS privilege (fails if present)
2. Creates extensions: `uuid-ossp`, `ltree`
3. Creates tables: `tenants`, `config_entries`, `permission_policies`, `api_keys`
4. Creates indexes, triggers, and RLS policies

### Connection Pool

Managed in `src/db/connection.ts`. Graceful shutdown closes the pool on SIGTERM/SIGINT.

## Middleware

### Authentication (`src/middleware/auth.ts`)

1. Skips `/api/v1/health`
2. Validates API key (X-API-Key header) via hash lookup
3. Falls back to JWT Bearer token
4. Returns 401 if neither is valid

### Error Handler (`src/middleware/error-handler.ts`)

Maps Stratum errors to HTTP status codes and formats consistent error responses.

## Docker

```bash
# Build
docker build -t stratum-control-plane .

# Run
docker run -p 3001:3001 \
  -e DATABASE_URL=postgres://user:pass@host:5432/stratum \
  -e JWT_SECRET=your-secret \
  stratum-control-plane
```
