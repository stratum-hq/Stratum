# API Reference

Base URL: `http://localhost:3001` (default)

Interactive Swagger UI: `http://localhost:3001/api/docs`

## Authentication

All endpoints (except health) require one of:

| Method | Header | Format |
|--------|--------|--------|
| API Key | `X-API-Key` | `sk_live_...` or `sk_test_...` |
| JWT | `Authorization` | `Bearer <token>` |

## Endpoints

### Health

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/health` | Health check (no auth required) |

### Tenants

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/tenants` | [List tenants](#list-tenants) (cursor pagination) |
| `POST` | `/api/v1/tenants` | [Create tenant](#create-tenant) |
| `GET` | `/api/v1/tenants/:id` | [Get tenant](#get-tenant) |
| `PATCH` | `/api/v1/tenants/:id` | [Update tenant](#update-tenant) |
| `DELETE` | `/api/v1/tenants/:id` | [Archive tenant](#archive-tenant) (soft delete) |
| `POST` | `/api/v1/tenants/:id/move` | [Move tenant](#move-tenant) |
| `GET` | `/api/v1/tenants/:id/ancestors` | [Get ancestors](#get-ancestors) |
| `GET` | `/api/v1/tenants/:id/descendants` | [Get descendants](#get-descendants) |
| `GET` | `/api/v1/tenants/:id/children` | [Get children](#get-children) |
| `GET` | `/api/v1/tenants/:id/context` | [Resolve context](#resolve-context) (config + permissions) |

### Config

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/tenants/:id/config` | [Get resolved config](#get-config) |
| `PUT` | `/api/v1/tenants/:id/config/:key` | [Set config value](#set-config) |
| `DELETE` | `/api/v1/tenants/:id/config/:key` | [Delete config override](#delete-config) |
| `GET` | `/api/v1/tenants/:id/config/inheritance` | [Get inheritance view](#get-config-inheritance) |

### Permissions

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/tenants/:id/permissions` | [Get resolved permissions](#get-permissions) |
| `POST` | `/api/v1/tenants/:id/permissions` | [Create permission](#create-permission) |
| `PATCH` | `/api/v1/tenants/:id/permissions/:policyId` | [Update permission](#update-permission) |
| `DELETE` | `/api/v1/tenants/:id/permissions/:policyId` | [Delete permission](#delete-permission) |

### API Keys

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/api-keys` | [Create API key](#create-api-key) (plaintext returned once) |
| `GET` | `/api/v1/api-keys` | List API keys (optional `?tenant_id=` filter) |
| `DELETE` | `/api/v1/api-keys/:id` | [Revoke API key](#revoke-api-key) |
| `POST` | `/api/v1/api-keys/:id/rotate` | Rotate API key (revoke old + create new) |
| `GET` | `/api/v1/api-keys/dormant` | List dormant keys (unused > N days) |

### Webhooks

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/webhooks` | Create webhook |
| `GET` | `/api/v1/webhooks` | List webhooks |
| `GET` | `/api/v1/webhooks/:id` | Get webhook |
| `PATCH` | `/api/v1/webhooks/:id` | Update webhook |
| `DELETE` | `/api/v1/webhooks/:id` | Delete webhook |
| `POST` | `/api/v1/webhooks/:id/test` | Test webhook delivery |
| `GET` | `/api/v1/webhooks/:id/deliveries` | List delivery history for a webhook |

### Audit Logs

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/audit-logs` | List audit logs (with filters, cursor pagination) |
| `GET` | `/api/v1/audit-logs/:id` | Get single audit entry |

### Consent

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/tenants/:id/consent` | Grant consent |
| `GET` | `/api/v1/tenants/:id/consent` | List consent records |
| `DELETE` | `/api/v1/tenants/:id/consent/:purpose` | Revoke consent |

### Regions

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/regions` | List regions |
| `POST` | `/api/v1/regions` | Create region |
| `PATCH` | `/api/v1/regions/:id` | Update region |
| `DELETE` | `/api/v1/regions/:id` | Delete region |

### GDPR & Maintenance

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/tenants/:id/export` | Export all tenant data (Article 20) |
| `POST` | `/api/v1/tenants/:id/purge` | Hard-delete all tenant data (Article 17) |
| `POST` | `/api/v1/tenants/:id/migrate-region` | Migrate tenant to new region |
| `POST` | `/api/v1/maintenance/purge-expired` | Purge expired logs/events |

---

## Tenant Endpoints

### List Tenants

```
GET /api/v1/tenants?cursor=<uuid>&limit=50
```

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `cursor` | UUID | — | Cursor for pagination (tenant ID) |
| `limit` | number | 50 | Max results (1-100) |

**Response:** `200 OK`

```json
{
  "data": [
    {
      "id": "uuid",
      "parent_id": "uuid | null",
      "name": "Acme Corp",
      "slug": "acme_corp",
      "ancestry_path": "/uuid",
      "depth": 0,
      "config": {},
      "metadata": {},
      "isolation_strategy": "SHARED_RLS",
      "status": "active",
      "deleted_at": null,
      "created_at": "2024-01-01T00:00:00.000Z",
      "updated_at": "2024-01-01T00:00:00.000Z"
    }
  ],
  "next_cursor": "uuid | null",
  "has_more": false
}
```

### Create Tenant

```
POST /api/v1/tenants
```

**Body:**

```json
{
  "name": "Acme Corp",
  "slug": "acme_corp",
  "parent_id": "uuid (optional)",
  "config": {},
  "metadata": {},
  "isolation_strategy": "SHARED_RLS"
}
```

**Response:** `201 Created` — returns the tenant object.

### Get Tenant

```
GET /api/v1/tenants/:id
```

**Response:** `200 OK` — returns the tenant object.

### Update Tenant

```
PATCH /api/v1/tenants/:id
```

**Body** (all fields optional):

```json
{
  "name": "New Name",
  "slug": "new_slug",
  "config": { "key": "value" },
  "metadata": { "key": "value" }
}
```

**Response:** `200 OK` — returns the updated tenant.

### Archive Tenant

```
DELETE /api/v1/tenants/:id
```

Soft-deletes the tenant (sets `status = 'archived'`). Fails if the tenant has active children.

**Response:** `204 No Content`

### Move Tenant

```
POST /api/v1/tenants/:id/move
```

**Body:**

```json
{
  "new_parent_id": "uuid"
}
```

Moves the tenant (and all descendants) under a new parent. Performs cycle detection.

**Response:** `200 OK` — returns the updated tenant.

### Get Ancestors

```
GET /api/v1/tenants/:id/ancestors
```

**Response:** `200 OK` — returns an array of tenant objects from root to parent.

### Get Descendants

```
GET /api/v1/tenants/:id/descendants
```

**Response:** `200 OK` — returns all descendants (uses ltree for efficient subtree query).

### Get Children

```
GET /api/v1/tenants/:id/children
```

**Response:** `200 OK` — returns direct children only.

### Resolve Context

```
GET /api/v1/tenants/:id/context
```

Returns the full tenant context including resolved config and permissions.

**Response:** `200 OK`

```json
{
  "tenant_id": "uuid",
  "ancestry_path": "/uuid1/uuid2",
  "depth": 1,
  "isolation_strategy": "SHARED_RLS",
  "resolved_config": {
    "max_users": {
      "key": "max_users",
      "value": 500,
      "source_tenant_id": "uuid",
      "inherited": true,
      "locked": false
    }
  },
  "resolved_permissions": {
    "manage_users": {
      "key": "manage_users",
      "value": true,
      "mode": "LOCKED",
      "source_tenant_id": "uuid",
      "locked": true,
      "delegated": false
    }
  }
}
```

---

## Config Endpoints

### Get Config

```
GET /api/v1/tenants/:id/config
```

Returns resolved config for the tenant (with inheritance applied).

**Response:** `200 OK` — `Record<string, ResolvedConfigEntry>`

### Set Config

```
PUT /api/v1/tenants/:id/config/:key
```

**Body:**

```json
{
  "value": "any JSON value",
  "locked": false
}
```

Fails with `409 Conflict` if the key is locked by an ancestor.

**Response:** `200 OK` — returns the config entry.

### Delete Config

```
DELETE /api/v1/tenants/:id/config/:key
```

Removes the tenant's override for this key. Inherited values from ancestors still apply.

**Response:** `204 No Content`

### Get Config Inheritance

```
GET /api/v1/tenants/:id/config/inheritance
```

Returns full config with inheritance metadata (which level set each value, whether it's inherited or overridden).

**Response:** `200 OK`

---

## Permission Endpoints

### Get Permissions

```
GET /api/v1/tenants/:id/permissions
```

Returns resolved permissions with mode and source tracking.

**Response:** `200 OK` — `Record<string, ResolvedPermission>`

### Create Permission

```
POST /api/v1/tenants/:id/permissions
```

**Body:**

```json
{
  "key": "manage_users",
  "value": true,
  "mode": "LOCKED",
  "revocation_mode": "CASCADE"
}
```

| Field | Values | Default |
|-------|--------|---------|
| `mode` | `LOCKED`, `INHERITED`, `DELEGATED` | `INHERITED` |
| `revocation_mode` | `CASCADE`, `SOFT`, `PERMANENT` | `CASCADE` |

**Response:** `201 Created` — returns the permission policy.

### Update Permission

```
PATCH /api/v1/tenants/:id/permissions/:policyId
```

**Body** (all optional):

```json
{
  "value": true,
  "mode": "DELEGATED",
  "revocation_mode": "SOFT"
}
```

**Response:** `200 OK` — returns the updated policy.

### Delete Permission

```
DELETE /api/v1/tenants/:id/permissions/:policyId
```

Behavior depends on revocation mode:
- **CASCADE** — deletes from this tenant and all descendants
- **SOFT** — deletes only from this tenant
- **PERMANENT** — returns `403 Forbidden`

**Response:** `204 No Content`

---

## API Key Endpoints

### Create API Key

```
POST /api/v1/api-keys
```

**Body:**

```json
{
  "tenant_id": "uuid",
  "name": "my-service (optional)"
}
```

**Response:** `201 Created`

```json
{
  "id": "uuid",
  "tenant_id": "uuid",
  "key_prefix": "sk_live_abc",
  "name": "my-service",
  "created_at": "2024-01-01T00:00:00.000Z",
  "plaintext_key": "sk_live_abc123..."
}
```

> **Warning:** The `plaintext_key` is only returned in this response. It cannot be retrieved again.

### Revoke API Key

```
DELETE /api/v1/api-keys/:id
```

**Response:** `204 No Content`

---

## Error Responses

All errors follow this format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message"
  }
}
```

| Code | Status | Description |
|------|--------|-------------|
| `UNAUTHORIZED` | 401 | Missing or invalid authentication |
| `FORBIDDEN` | 403 | Insufficient scope for the requested operation |
| `TENANT_NOT_FOUND` | 404 | Tenant ID does not exist |
| `TENANT_ARCHIVED` | 410 | Tenant has been archived |
| `CONFIG_LOCKED` | 409 | Config key is locked by an ancestor |
| `PERMISSION_LOCKED` | 409 | Permission is locked by an ancestor |
| `PERMISSION_REVOCATION_DENIED` | 403 | Permission has PERMANENT revocation mode |
| `MISSING_TENANT` | 400 | Tenant ID could not be resolved from request |
| `HAS_CHILDREN` | 409 | Cannot archive/purge tenant with active children |
| `CYCLE_DETECTED` | 409 | Move would create a cycle in the tree |
| `VALIDATION_ERROR` | 400 | Request body validation failed |
| `NOT_FOUND` | 404 | Resource not found (API key, audit entry, consent record, etc.) |
| `CONFLICT` | 409 | Resource conflict (e.g., slug already exists) |
| `INTERNAL_SERVER_ERROR` | 500 | Unexpected server error |
