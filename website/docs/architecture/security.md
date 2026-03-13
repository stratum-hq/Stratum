---
sidebar_position: 3
title: Security
---

# Security

## Authentication

The control plane supports two authentication methods:

### API Keys

- Format: `sk_live_<base64>` (production) or `sk_test_<base64>` (development)
- Header: `X-API-Key`
- Storage: HMAC-SHA256 hashed (keyed with `STRATUM_API_KEY_HMAC_SECRET`) — plaintext is never stored. Falls back to SHA-256 if HMAC secret is not configured. Legacy SHA-256 hashes are transparently upgraded to HMAC on next validation. Secrets additionally encrypted with AES-256-GCM at rest
- Generated with 256-bit entropy (`crypto.randomBytes(32)`)
- Displayed once at creation time, cannot be retrieved again
- **Scopes**: each key carries a `scopes` array (`read`, `write`, `admin`) controlling permitted operations
- **Expiration**: optional `expires_at` timestamp — expired keys are automatically rejected during validation
- **Rotation**: atomic rotate endpoint creates a new key and revokes the old one in a single transaction

### JWT Bearer Tokens

- Header: `Authorization: Bearer <token>`
- Configurable claim path for tenant ID extraction
- Signature verification via `jwtSecret` or custom `jwtVerify` function

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

### CORS

Configurable via `ALLOWED_ORIGINS` environment variable (comma-separated). Defaults to `http://localhost:3000,http://localhost:3300` in development.

### Rate Limiting

Configurable per-IP rate limiting via `@fastify/rate-limit`:
- `RATE_LIMIT_MAX` — max requests per window (default: 100)
- `RATE_LIMIT_WINDOW` — time window (default: "1 minute")

## Soft Delete

Tenants are never hard-deleted. The `DELETE` endpoint archives them by setting `status = 'archived'` and `deleted_at = now()`. The `ON DELETE RESTRICT` foreign key prevents deleting tenants that have children. For GDPR compliance, a separate hard-purge endpoint (`POST /api/v1/tenants/:id/purge`) permanently removes all tenant data.

## Authorization Scopes

API keys carry scopes that restrict their capabilities:

| Scope | Permitted Operations |
|-------|---------------------|
| `read` | `GET` requests — list tenants, resolve config, view audit logs |
| `write` | `POST`, `PATCH`, `DELETE` — create tenants, update config, manage permissions |
| `admin` | API key management, audit log access, maintenance operations (purge expired records) |

New API keys default to `['read', 'write']`. JWT tokens receive full `['read', 'write', 'admin']` privileges. The `authorize` middleware checks the request's HTTP method and route pattern against the caller's scopes and returns `403 Forbidden` if the required scope is missing.

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

## Field-Level Encryption

Sensitive data is encrypted at rest using AES-256-GCM:

- **Algorithm**: AES-256-GCM with random 12-byte IV per encryption operation
- **Format**: `v1:iv:authTag:ciphertext` — the version prefix enables seamless key rotation
- **Scope**: config entries marked `sensitive: true`, webhook secrets
- **Key**: sourced from `STRATUM_ENCRYPTION_KEY` environment variable (or `WEBHOOK_ENCRYPTION_KEY` for backward compatibility)
- **Integrity**: GCM authentication tag prevents tampering with ciphertext

The shared crypto module is used across all services that need encryption, ensuring consistent behavior and a single key management surface.

## Audit Logging

All state-mutating operations are recorded in an append-only `audit_logs` table:

- **Actor tracking**: captures API key ID or JWT subject for every mutation
- **Before/after snapshots**: JSON state of the resource before and after the change
- **Tamper resistance**: audit logs are append-only; no update or delete operations are exposed
- **Retention**: configurable purge of old entries via `POST /api/v1/maintenance/purge-expired` (default 90-day retention)

Audit logs provide a complete forensic trail for compliance (SOC 2, GDPR Article 30 records of processing activities).

## JWT Secret

In production (`NODE_ENV=production`), missing `JWT_SECRET` triggers a loud console warning banner. A development fallback is provided for local use only.

## Security Checklist

When deploying to production, ensure:

- [ ] `JWT_SECRET` is set to a strong, unique value
- [ ] `NODE_ENV=production` is set
- [ ] Database role does NOT have `BYPASSRLS` privilege
- [ ] `ALLOWED_ORIGINS` is restricted to your domains
- [ ] API keys use `sk_live_` prefix (not `sk_test_`)
- [ ] Database connections use TLS (`?sslmode=require`)
- [ ] Rate limiting is configured appropriately
- [ ] `STRATUM_ENCRYPTION_KEY` is set to a 256-bit key for field-level encryption
- [ ] `STRATUM_API_KEY_HMAC_SECRET` is set to a strong random secret for API key hashing
- [ ] API key scopes are reviewed — avoid granting `admin` scope unless necessary
- [ ] Webhook URLs are validated (SSRF protection is enabled by default)
- [ ] Audit log retention period is configured for your compliance requirements
- [ ] Reverse proxy handles HTTPS termination
