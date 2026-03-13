---
sidebar_position: 3
title: "@stratum/control-plane"
---

# @stratum/control-plane

REST API server for tenant management, configuration, permissions, and API key lifecycle. A thin Fastify wrapper around `@stratum/lib`.

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

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Listen port |
| `DATABASE_URL` | `postgres://stratum:stratum_dev@localhost:5432/stratum` | PostgreSQL connection string |
| `NODE_ENV` | `development` | Environment |
| `JWT_SECRET` | `dev-secret-change-in-production` | JWT signing/verification secret |
| `ALLOWED_ORIGINS` | `http://localhost:3000,http://localhost:3300` | CORS origins (comma-separated) |
| `RATE_LIMIT_MAX` | `100` | Max requests per rate limit window |
| `RATE_LIMIT_WINDOW` | `1 minute` | Rate limit window duration |
| `STRATUM_ENCRYPTION_KEY` | `stratum-dev-key` | AES-256-GCM encryption key for sensitive data |
| `STRATUM_API_KEY_HMAC_SECRET` | — | HMAC-SHA256 secret for API key hashing (recommended in production) |

## Architecture

The control plane creates a `Stratum` instance from `@stratum/lib` and wraps it in Fastify routes:

```typescript
import { Stratum } from "@stratum/lib";

const stratum = new Stratum({
  pool: getPool(),
  keyPrefix: config.nodeEnv === "production" ? "sk_live_" : "sk_test_",
});

// Routes receive the stratum instance via factory functions
app.register(createTenantRoutes(stratum), { prefix: "/api/v1/tenants" });
app.register(createConfigRoutes(stratum), { prefix: "/api/v1/tenants" });
app.register(createPermissionRoutes(stratum), { prefix: "/api/v1/tenants" });
app.register(createApiKeyRoutes(stratum), { prefix: "/api/v1/api-keys" });
```

## API Endpoints

See the full [API Reference](/docs/api/rest-api).

### Summary

- **Tenants**: CRUD, move, archive, tree navigation, context resolution
- **Config**: Get/set/delete with inheritance and lock semantics
- **Permissions**: CRUD with mode (LOCKED/INHERITED/DELEGATED) and revocation
- **API Keys**: Create (display-once) and revoke
- **Health**: `GET /api/v1/health`

### Swagger UI

Available at `/api/docs` when the server is running.

## Middleware

### Authentication

1. Skips `/api/v1/health`
2. Validates API key (`X-API-Key` header) via hash lookup
3. Falls back to JWT Bearer token
4. Returns 401 if neither is valid

### Error Handler

Maps Stratum errors to HTTP status codes:

| Error | HTTP Status |
|-------|-------------|
| `TenantNotFoundError` | 404 |
| `TenantArchivedError` | 410 |
| `TenantAlreadyExistsError` | 409 |
| `TenantHasChildrenError` | 409 |
| `TenantCycleDetectedError` | 409 |
| `ConfigLockedError` | 409 |
| `PermissionLockedError` | 409 |
| `PermissionRevocationDeniedError` | 403 |
| `UnauthorizedError` | 401 |
| `ValidationError` | 400 |

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
