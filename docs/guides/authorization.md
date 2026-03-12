# Authorization & Scopes

Stratum uses scoped API keys and JWT tokens to control access to the control plane API.

## Authentication Methods

### API Keys

API keys are the primary authentication method. Each key is a 256-bit random value with a recognizable prefix:

```
sk_live_<base64>   — production keys
sk_test_<base64>   — development/test keys
```

Pass the key in the `X-API-Key` header:

```bash
curl http://localhost:3001/api/v1/tenants \
  -H "X-API-Key: sk_live_abc123..."
```

Keys are stored as SHA-256 hashes. The plaintext is returned only once at creation time and cannot be retrieved again.

### JWT Bearer Tokens

Alternatively, pass a JWT in the `Authorization` header:

```bash
curl http://localhost:3001/api/v1/tenants \
  -H "Authorization: Bearer eyJhbG..."
```

JWTs are verified using the `JWT_SECRET` environment variable (HS256 only). If the JWT has no `scopes` claim, it defaults to read-only access (`["read"]`). To grant broader access, include explicit scopes in the JWT payload.

## Scopes

Three scopes control what operations a key or token can perform:

| Scope | Allows |
|-------|--------|
| `read` | GET, HEAD, OPTIONS requests |
| `write` | POST, PUT, PATCH, DELETE on standard routes |
| `admin` | Admin-only routes (see below) |

Scopes are **flat** — each scope grants access to its own set of operations independently. A key with `["read", "write"]` can read and mutate standard routes. A key with `["admin"]` can access admin routes but needs `["read", "admin"]` to also perform GET requests on standard routes.

### Admin-Only Routes

These routes require the `admin` scope regardless of HTTP method:

| Route Pattern | Description |
|---------------|-------------|
| `/api/v1/api-keys/*` | API key management |
| `/api/v1/audit-logs/*` | Audit log access |
| `/api/v1/maintenance/*` | Data purge operations |
| `/api/v1/regions/*` | Region management |
| `/api/v1/tenants/:id/purge` | GDPR hard-delete |
| `/api/v1/tenants/:id/export` | GDPR data export |
| `/api/v1/tenants/:id/migrate-region` | Region migration |

All other routes follow standard scope mapping (GET = `read`, mutations = `write`).

## API Key Management

### Create a Key

```bash
curl -X POST http://localhost:3001/api/v1/api-keys \
  -H "X-API-Key: YOUR_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"tenant_id": "TENANT_UUID", "name": "my-service"}'
```

Response:

```json
{
  "id": "key-uuid",
  "tenant_id": "tenant-uuid",
  "key_prefix": "sk_live_abc",
  "name": "my-service",
  "plaintext_key": "sk_live_abc123...",
  "created_at": "2024-01-15T10:30:00.000Z"
}
```

Save `plaintext_key` immediately — it is never shown again.

### Tenant-Scoped vs Global Keys

- **Tenant-scoped** (`tenant_id` set): Can only access data for that tenant and its descendants in the hierarchy
- **Global** (`tenant_id` null): Can access all tenants

Tenant scope enforcement is applied on every route group:
- Single-resource routes (tenants, config, permissions, consent, webhooks) check that the target tenant is the key's tenant or a descendant via `ancestry_path`
- List endpoints (audit logs, API keys) force-filter results to the key's tenant
- API key creation validates that the `tenant_id` in the request body is within scope

### Per-Key Rate Limiting

API keys can optionally specify rate limits at creation time:

```bash
curl -X POST http://localhost:3001/api/v1/api-keys \
  -H "X-API-Key: YOUR_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"tenant_id": "TENANT_UUID", "name": "limited-key", "rate_limit_max": 50, "rate_limit_window": "1 minute"}'
```

- `rate_limit_max`: Maximum requests allowed per window (1–100,000)
- `rate_limit_window`: Time window (e.g., `"30 seconds"`, `"1 minute"`, `"1 hour"`)
- Keys without per-key limits fall back to the global `RATE_LIMIT_MAX`/`RATE_LIMIT_WINDOW`
- Enforced via in-memory sliding window middleware
- Returns 429 with `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining` headers

### Rotate a Key

```bash
curl -X POST http://localhost:3001/api/v1/api-keys/KEY_UUID/rotate \
  -H "X-API-Key: YOUR_ADMIN_KEY"
```

This revokes the old key and returns a new one.

### Revoke a Key

```bash
curl -X DELETE http://localhost:3001/api/v1/api-keys/KEY_UUID \
  -H "X-API-Key: YOUR_ADMIN_KEY"
```

### List Dormant Keys

Find keys that haven't been used recently:

```bash
curl "http://localhost:3001/api/v1/api-keys/dormant?days=90" \
  -H "X-API-Key: YOUR_ADMIN_KEY"
```

## Via the Library

```typescript
import { Stratum } from "@stratum/lib";

// Create
const { plaintext_key } = await stratum.createApiKey("tenant-uuid", "my-key");

// Validate (returns null if invalid/revoked/expired)
const result = await stratum.validateApiKey("sk_live_abc123...");
// { tenant_id: "uuid", key_id: "uuid", scopes: ["read", "write"] }

// Rotate
const newKey = await stratum.rotateApiKey("key-uuid");

// Revoke
await stratum.revokeApiKey("key-uuid");

// List dormant
const dormant = await stratum.listDormantKeys(90);
```

## Error Responses

| Status | Code | Cause |
|--------|------|-------|
| 401 | `UNAUTHORIZED` | Missing or invalid API key / JWT |
| 403 | `FORBIDDEN` | Insufficient scope for the requested operation |
| 401 | `UNAUTHORIZED` | Revoked or expired API key |

## Role-Based Access Control (RBAC)

Beyond flat scopes, Stratum supports named roles that bundle scopes into reusable collections.

### Creating Roles

```bash
curl -X POST http://localhost:3001/api/v1/roles \
  -H "X-API-Key: YOUR_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "Editor", "scopes": ["read", "write"], "description": "Read and write access"}'
```

Roles can be **global** (`tenant_id` omitted or null) or **tenant-scoped** (tied to a specific tenant).

### Assigning Roles to API Keys

```bash
curl -X POST http://localhost:3001/api/v1/roles/assign/KEY_UUID \
  -H "X-API-Key: YOUR_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"role_id": "ROLE_UUID"}'
```

When a role is assigned, the role's scopes **override** the key's default scopes. Removing the role reverts the key to its own scopes.

### Via the Library

```typescript
const role = await stratum.createRole({
  name: "Viewer",
  scopes: ["read"],
  description: "Read-only access",
});

await stratum.assignRoleToKey("key-uuid", role.id);

// Resolve effective scopes (returns role scopes if assigned, key scopes otherwise)
const scopes = await stratum.resolveKeyScopes("key-uuid");
// → ["read"]
```

## Best Practices

1. **Use tenant-scoped keys** for application services that only need access to one tenant
2. **Use `read` scope** for monitoring and analytics services
3. **Rotate keys regularly** — use the rotate endpoint to issue new keys without downtime
4. **Monitor dormant keys** — revoke keys that haven't been used in 90+ days
5. **Never commit keys** — use environment variables or a secrets manager
6. **Set `JWT_SECRET`** in production — the dev fallback is insecure
