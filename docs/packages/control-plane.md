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
| `STRATUM_ENCRYPTION_KEY` | `stratum-dev-key` | AES-256-GCM encryption key for sensitive data |
| `STRATUM_API_KEY_HMAC_SECRET` | — | HMAC-SHA256 secret for API key hashing (recommended in production) |

## API Endpoints

See the full [API Reference](../api/README.md).

### Summary

- **Tenants**: CRUD, move, archive, tree navigation, context resolution, purge (GDPR), export
- **Config**: Get/set/delete with inheritance, lock semantics, and field-level encryption for sensitive values
- **Permissions**: CRUD with mode (LOCKED/INHERITED/DELEGATED) and revocation
- **API Keys**: Create (display-once), revoke, rotate, list, dormant key detection
- **Audit Logs**: Query with filters (tenant, action, date range, actor), cursor-based pagination
- **Consent**: Grant, list, revoke per-tenant consent records with expiration
- **Regions**: CRUD for multi-region support, tenant migration between regions
- **Maintenance**: Automated purge of expired data, encryption key rotation
- **Webhooks**: CRUD, test delivery, event tracking, dead-letter queue (failed listing, retry)
- **Roles (RBAC)**: CRUD for named roles, assign/remove role from API keys
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
- HMAC-SHA256 hashed storage (keyed with `STRATUM_API_KEY_HMAC_SECRET`) — prevents offline brute-force from DB dumps. Falls back to SHA-256 when HMAC secret is not set.
- Transparent hash upgrade: legacy SHA-256 keys are automatically re-hashed to HMAC on next successful validation
- Validation with `last_used_at` tracking and scope enforcement
- Revocation via timestamp
- Key rotation (atomic revoke + create)
- Expiration support (`expires_at`)
- Dormant key detection (unused > N days)

### audit-service

Immutable audit trail for all mutations:
- Records actor, action, resource, tenant, before/after state
- Cursor-based pagination with date range filtering
- Integrated into all mutation routes via `AuditContext`

### consent-service

GDPR consent management:
- Grant/revoke/list per-tenant, per-subject consent records
- Purpose-based with optional expiration
- Active consent check (respects expiry)

### retention-service

Data retention and GDPR erasure:
- `purgeExpiredData(days)` — removes old audit logs, events, deliveries
- `purgeTenant(id)` — hard-deletes all tenant data (Article 17)
- `exportTenantData(id)` — structured JSON export (Article 20)

### crypto

Shared AES-256-GCM encryption:
- Key derived via HKDF-SHA256 (not raw SHA-256)
- Key versioned format (`v1:iv:tag:ciphertext`)
- Used by webhook secrets and sensitive config values
- `reEncrypt()` for zero-downtime key rotation

## Database

### Migrations

Located in `src/db/migrations/`. Run automatically on startup via `src/db/migrate.ts`.

Migrations include:

| Migration | Tables/Changes |
|-----------|---------------|
| `001_init.sql` | `tenants`, `config_entries`, `permission_policies`, `api_keys` + RLS |
| `002_schema_isolation.sql` | Schema-per-tenant isolation support |
| `003_db_isolation.sql` | Database-per-tenant isolation support |
| `004_webhooks.sql` | `webhooks`, `webhook_events`, `webhook_deliveries` |
| `005_audit_logs.sql` | `audit_logs` for immutable audit trail |
| `006_api_key_scopes.sql` | `scopes` column on `api_keys` |
| `007_sensitive_config.sql` | `sensitive` flag on `config_entries` |
| `008_api_key_management.sql` | `expires_at`, rate limit columns on `api_keys` |
| `009_consent.sql` | `consent_records` table |
| `010_multi_region.sql` | `regions` table, `region_id` on `tenants` |
| `011_demo_bootstrap.sql` | Demo seed data for interactive demo |
| `012_roles.sql` | `roles` table, `role_id` on `api_keys` |
| `013_api_key_hmac.sql` | `hash_version` column on `api_keys` for HMAC migration |

### Connection Pool

Managed in `src/db/connection.ts`. Graceful shutdown closes the pool on SIGTERM/SIGINT.

## Middleware

### Authentication (`src/middleware/auth.ts`)

1. Skips `/api/v1/health`
2. Validates API key (X-API-Key header) via hash lookup
3. Falls back to JWT Bearer token (HS256 only, defaults to `read` scope)
4. Returns 401 if neither is valid

### Authorization (`src/middleware/authorize.ts`)

Scope-based access control applied after authentication:
- Maps HTTP methods to required scopes: GET → `read`, mutations → `write`
- Admin-only routes: api-keys, audit-logs, maintenance, purge, migrate-region
- Returns 403 Forbidden for insufficient scopes
- Fails closed if no API key is present

### Per-Key Rate Limiting (`src/middleware/per-key-rate-limit.ts`)

In-memory sliding window rate limiter enforced per API key:
- Uses `rate_limit_max` and `rate_limit_window` from the API key record
- Falls back to global `RATE_LIMIT_MAX`/`RATE_LIMIT_WINDOW` env vars when key has no per-key limits
- Returns 429 with `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining` headers
- Skips rate limiting for JWT-authenticated requests

### Tenant Scope Guard (`src/middleware/tenant-scope.ts`)

Hierarchy-aware access enforcement for tenant-scoped API keys:
- Global keys (`tenant_id = null`) have unrestricted access
- Scoped keys can access their own tenant and its descendants via `ancestry_path`
- Applied as a plugin-level `preHandler` on tenant, config, permission, and consent routes
- Applied per-route on API key creation (checks body `tenant_id`)
- Force-filters list endpoints (audit logs, API keys) to the key's tenant
- Extractor functions: `fromParamId`, `fromParamTenantId`, `fromQueryTenantId`, `fromBodyTenantId`

### Role Service (`src/services/role-service.ts` via `@stratum/lib`)

Named role management for RBAC:
- Roles have a name, description, and a set of scopes (`read`, `write`, `admin`)
- Roles can be global (`tenant_id = null`) or tenant-scoped
- Assigned to API keys via `role_id` — role scopes override key scopes when assigned
- `resolveKeyScopes()` returns role scopes when a role is assigned, falls back to the key's own scopes

### Error Handler (`src/middleware/error-handler.ts`)

Maps Stratum errors to HTTP status codes. Consistent response format: `{ error: { code, message } }`.

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
