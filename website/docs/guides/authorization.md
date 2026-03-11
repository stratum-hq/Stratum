---
sidebar_position: 10
title: Authorization & Scopes
---

# Authorization & Scopes

API keys and JWTs carry scopes that control what operations they can perform. Stratum enforces these scopes at the route level, ensuring that credentials are limited to the actions they were granted.

## Scope Definitions

Stratum defines three scopes:

| Scope | Allowed Methods | Description |
|-------|----------------|-------------|
| `read` | `GET`, `HEAD`, `OPTIONS` | Read-only access to resources |
| `write` | `POST`, `PATCH`, `DELETE` | Create, update, and delete resources |
| `admin` | All methods | Full access including key management, audit logs, and maintenance |

A credential can carry one or more scopes. The request is authorized if the credential holds at least one scope that permits the HTTP method being used.

---

## Default Scopes

### API Keys

New API keys are created with `['read', 'write']` by default:

```typescript
const key = await s.createApiKey("TENANT_UUID", "My Key");
// key.scopes → ['read', 'write']
```

You can specify scopes explicitly at creation:

```typescript
const readOnlyKey = await s.createApiKey("TENANT_UUID", "Read-Only Key", {
  scopes: ["read"],
});
```

### JWT Tokens

JWT-authenticated requests automatically receive all three scopes:

```
['read', 'write', 'admin']
```

This reflects that JWTs typically represent authenticated human operators with full access.

---

## Admin Routes

The following route groups require the `admin` scope:

| Route Group | Description |
|-------------|-------------|
| `/api/v1/api-keys/*` | API key management (create, rotate, list, delete) |
| `/api/v1/audit-logs/*` | Audit log queries |
| `/api/v1/maintenance/*` | Data retention and maintenance operations |

Requests to these routes with a credential that lacks `admin` will receive a `403 Forbidden` response:

```json
{
  "error": "Forbidden",
  "message": "Insufficient scope. Required: admin"
}
```

---

## Tenant Access Control

API keys scoped to a specific tenant can only access resources belonging to that tenant or its descendants. This follows the hierarchical tenant tree — a key scoped to an MSP tenant can access that MSP's clients, but not sibling MSPs or the parent MSSP.

```typescript
// Key scoped to tenant "msp-acme" — can access msp-acme and its children
const key = await s.createApiKey("MSP_ACME_UUID", "MSP Key");

// This works — reading the tenant the key is scoped to
await s.getTenant("MSP_ACME_UUID"); // OK

// This works — reading a child tenant
await s.getTenant("ACME_CLIENT_UUID"); // OK

// This fails — reading a sibling tenant
await s.getTenant("MSP_OTHER_UUID"); // 403 Forbidden
```

Global (unscoped) API keys have access to the entire tenant tree.

---

## Checking Scopes in Custom Middleware

If you build custom routes on top of Stratum, you can check scopes from the request context:

```typescript
import { requireScope } from "@stratum/control-plane/middleware";

// Protect a custom route with the admin scope
app.get("/custom/admin-route", requireScope("admin"), async (req, res) => {
  // Only reachable with admin scope
  res.json({ status: "ok" });
});
```

---

## Migration

The scopes system was introduced in migration `006_api_key_scopes.sql`. This migration adds a `scopes` column to the `api_keys` table with a default value of `['read', 'write']`, ensuring backward compatibility with existing keys.

Existing API keys created before this migration automatically receive `read` and `write` scopes. To grant `admin` access to an existing key, update it:

```bash
curl -X PATCH http://localhost:3001/api/v1/api-keys/KEY_UUID \
  -H "Content-Type: application/json" \
  -H "X-API-Key: sk_live_..." \
  -d '{ "scopes": ["read", "write", "admin"] }'
```

---

## Best Practices

- **Principle of least privilege** — grant only the scopes a key actually needs. Most integrations only need `read` and `write`.
- **Use JWTs for human operators** — JWTs carry `admin` scope by default, appropriate for dashboard and management interfaces.
- **Use API keys for service-to-service** — scope keys to the specific tenant they serve to limit blast radius.
- **Audit admin access** — all admin-scoped operations are recorded in the [audit log](./audit-logging.md).
