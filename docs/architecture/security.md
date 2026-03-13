# Security

## Authentication

The control plane supports two authentication methods:

### API Keys

- Format: `sk_live_<base64>` (production) or `sk_test_<base64>` (development)
- Header: `X-API-Key`
- Storage: HMAC-SHA256 hashed (keyed with `STRATUM_API_KEY_HMAC_SECRET`) — plaintext is never stored. Falls back to SHA-256 if HMAC secret is not configured. Legacy SHA-256 hashes are transparently upgraded to HMAC on next validation.
- Generated with 256-bit entropy (`crypto.randomBytes(32)`)
- Displayed once at creation time, cannot be retrieved again

### JWT Bearer Tokens

- Header: `Authorization: Bearer <token>`
- Algorithm: HS256 only (pinned to prevent algorithm confusion attacks)
- Configurable claim path for tenant ID extraction
- Signature verification required via `jwtSecret` or custom `jwtVerify` function
- Without verification configured, JWT tokens are ignored entirely (fail-closed)
- Default scopes for JWTs without explicit `scopes` claim: `["read"]` (least privilege)

### Authorization (Scopes)

Three scopes control access: `read`, `write`, `admin`. See the [Authorization guide](../guides/authorization.md) for details.

- Scope enforcement via `authorize` middleware (runs after authentication)
- HTTP method mapping: GET → `read`, POST/PATCH/DELETE → `write`
- Admin-only routes: api-keys, audit-logs, maintenance, purge, migrate-region
- Returns `403 Forbidden` for insufficient scopes (not 401)
- Fails closed: missing API key after auth middleware triggers 401

### Unauthenticated Endpoints

Only `GET /api/v1/health` skips authentication.

## SQL Injection Prevention

### Parameterized Queries

All value-based queries use parameterized statements (`$1`, `$2`, etc.). Tenant context is set via:

```sql
SELECT set_config('app.current_tenant_id', $1, true);
```

This is parameterized — unlike the older `SET LOCAL` pattern which required string interpolation.

### DDL Table Name Validation

PostgreSQL parameterized queries cannot be used for table names in DDL statements (`CREATE POLICY`, `ALTER TABLE`, etc.). All table names are validated against a strict allowlist regex before use:

```typescript
function validateTableName(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid table name: ${name}`);
  }
  return name;
}
```

This is enforced in:
- `isolation-service.ts` (control plane)
- `manager.ts` (db-adapters RLS manager)
- `migration-helpers.ts` (db-adapters)

## Row-Level Security

### Tenant Isolation

Every tenant-scoped table has an RLS policy that filters rows to the current tenant:

```sql
CREATE POLICY tenant_isolation ON table_name
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
```

### FORCE RLS

`FORCE ROW LEVEL SECURITY` is enabled on all tenant tables. Without this, the table owner role could bypass RLS policies. With FORCE, even the owner must pass through the policy.

### BYPASSRLS Check

The migration checks at startup that the application database role does not have `BYPASSRLS` privilege. If it does, the migration fails with:

```
FATAL: application role "role_name" has BYPASSRLS. Revoke it.
```

To fix: `ALTER ROLE your_app_role NOBYPASSRLS;`

### Connection Context Reset

Tenant context (`app.current_tenant_id`) is always reset when a database connection is returned to the pool, preventing context leakage between requests:

```sql
RESET app.current_tenant_id;
```

## HTTP Security

### Helmet

All responses include security headers via `@fastify/helmet`:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Strict-Transport-Security` (when behind HTTPS)
- Content-Security-Policy
- And more

### CORS

Configurable via `ALLOWED_ORIGINS` environment variable (comma-separated). Defaults to `http://localhost:3000,http://localhost:3300` in development.

### Rate Limiting

Two layers of rate limiting protect the API:

**Global (per-IP):** Configurable via `@fastify/rate-limit`:
- `RATE_LIMIT_MAX` — max requests per window (default: 100)
- `RATE_LIMIT_WINDOW` — time window (default: "1 minute")

**Per-key:** In-memory sliding window enforced per API key:
- API keys can specify `rate_limit_max` and `rate_limit_window` at creation time
- Keys without per-key limits fall back to the global config
- Returns 429 with `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining` headers
- JWT-authenticated requests skip per-key rate limiting

### Tenant Scope Enforcement

Tenant-scoped API keys are restricted to their own tenant subtree:

- Global keys (`tenant_id = null`) have unrestricted access across all tenants
- Scoped keys can access their own tenant and its descendants (checked via `ancestry_path`)
- Applied on all route groups: tenants, config, permissions, consent, API keys, webhooks
- List endpoints (audit logs, API keys) are force-filtered to the key's tenant
- Hierarchy check: O(depth) ancestry path lookup, fast-path for exact tenant match

## Field-Level Encryption

Sensitive data is encrypted at rest using AES-256-GCM:

- Webhook secrets and sensitive config values are encrypted before storage
- Key versioned format (`v1:iv:tag:ciphertext`) supports rotation
- Random 12-byte IV per encryption prevents pattern analysis
- Key derived via HKDF-SHA256 from `STRATUM_ENCRYPTION_KEY` environment variable
- In production, missing encryption key triggers an error
- See the [Encryption guide](../guides/encryption.md) for details

## GDPR Compliance

Built-in tooling for data protection regulations:

- **Data Export** (Article 20): `GET /api/v1/tenants/:id/export` returns all tenant data as structured JSON
- **Right to Erasure** (Article 17): `POST /api/v1/tenants/:id/purge` hard-deletes all tenant data in FK-safe order
- **Consent Management**: Per-tenant, per-subject consent records with expiration tracking
- **Data Retention**: Configurable purge of expired audit logs, events, and deliveries
- **Audit Trail**: Immutable audit log for all mutations with actor context

## SSRF Protection

Webhook delivery URLs are validated against SSRF attacks:

- DNS resolution performed before connection (both IPv4 and IPv6 AAAA records)
- Private/reserved IP ranges blocked: `10.x`, `172.16-31.x`, `192.168.x`, `127.x`, `169.254.x`, `::1`, `fe80::`, `fc00::`
- Cloud metadata endpoints blocked: `169.254.169.254`, `metadata.google.internal`, `metadata.goog`, AWS IMDSv2 IPv6 (`fd00:ec2:`)
- DNS rebinding protection: resolution fails closed (rejects on DNS failure)

## Docker Security

All Docker images run as non-root:

- Node.js images: dedicated `stratum` user with UID/GID 1001
- Nginx images: uses built-in `nginx` user with adjusted permissions
- `.dockerignore` excludes `.env`, secrets, docs, IDE files, and build artifacts

## Soft Delete

Tenants are never hard-deleted. The `DELETE` endpoint archives them by setting `status = 'archived'` and `deleted_at = now()`. The `ON DELETE RESTRICT` foreign key prevents deleting tenants that have children.

## JWT Secret

In production (`NODE_ENV=production`), missing `JWT_SECRET` triggers a loud console warning banner. A development fallback is provided for local use only.
