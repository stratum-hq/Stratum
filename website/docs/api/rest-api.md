---
sidebar_position: 1
title: REST API Reference
---

# REST API Reference

Base URL: `http://localhost:3001` (default)

Interactive Swagger UI: `http://localhost:3001/api/docs`

## Authentication

All endpoints (except health) require one of:

| Method | Header | Format |
|--------|--------|--------|
| API Key | `X-API-Key` | `sk_live_...` or `sk_test_...` |
| JWT | `Authorization` | `Bearer <token>` |

## Endpoints Overview

### Health

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/health` | Health check (no auth required) |

### Tenants

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/tenants` | List tenants (cursor pagination) |
| `POST` | `/api/v1/tenants` | Create tenant |
| `GET` | `/api/v1/tenants/:id` | Get tenant |
| `PATCH` | `/api/v1/tenants/:id` | Update tenant |
| `DELETE` | `/api/v1/tenants/:id` | Archive tenant (soft delete) |
| `POST` | `/api/v1/tenants/:id/move` | Move tenant in hierarchy |
| `GET` | `/api/v1/tenants/:id/ancestors` | Get ancestors (root → parent) |
| `GET` | `/api/v1/tenants/:id/descendants` | Get all descendants |
| `GET` | `/api/v1/tenants/:id/children` | Get direct children |
| `GET` | `/api/v1/tenants/:id/context` | Resolve full context |
| `POST` | `/api/v1/tenants/:id/purge` | Hard-delete all tenant data (GDPR Article 17) |
| `GET` | `/api/v1/tenants/:id/export` | Export all tenant data as JSON (GDPR Article 20) |
| `POST` | `/api/v1/tenants/:id/migrate-region` | Migrate tenant to a different region |

### Config

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/tenants/:id/config` | Get resolved config |
| `PUT` | `/api/v1/tenants/:id/config/:key` | Set config value |
| `DELETE` | `/api/v1/tenants/:id/config/:key` | Delete config override |
| `GET` | `/api/v1/tenants/:id/config/inheritance` | Get inheritance view |

### Permissions

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/tenants/:id/permissions` | Get resolved permissions |
| `POST` | `/api/v1/tenants/:id/permissions` | Create permission |
| `PATCH` | `/api/v1/tenants/:id/permissions/:policyId` | Update permission |
| `DELETE` | `/api/v1/tenants/:id/permissions/:policyId` | Delete permission |

### API Keys

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/api-keys` | Create API key (plaintext returned once) |
| `GET` | `/api/v1/api-keys` | List API keys (optional `?tenant_id=`) |
| `DELETE` | `/api/v1/api-keys/:id` | Revoke API key |
| `POST` | `/api/v1/api-keys/:id/rotate` | Rotate API key (create new + revoke old atomically) |
| `GET` | `/api/v1/api-keys/dormant` | List dormant keys (unused > 90 days) |

### Webhooks

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/webhooks` | Register a webhook |
| `GET` | `/api/v1/webhooks` | List all webhooks |
| `GET` | `/api/v1/webhooks/:id` | Get webhook |
| `PATCH` | `/api/v1/webhooks/:id` | Update webhook |
| `DELETE` | `/api/v1/webhooks/:id` | Delete webhook |
| `GET` | `/api/v1/webhooks/:id/deliveries` | List delivery attempts |
| `POST` | `/api/v1/webhooks/:id/test` | Send a test event |

### Audit Logs

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/audit-logs` | List audit log entries (cursor pagination, filters) |
| `GET` | `/api/v1/audit-logs/:id` | Get a single audit log entry |

### Regions

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/regions` | Create a region |
| `GET` | `/api/v1/regions` | List all regions |
| `GET` | `/api/v1/regions/:id` | Get a region |
| `PATCH` | `/api/v1/regions/:id` | Update a region |
| `DELETE` | `/api/v1/regions/:id` | Delete a region |

### Consent

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/tenants/:tenantId/consent` | Create a consent record |
| `GET` | `/api/v1/tenants/:tenantId/consent` | List consent records for a tenant |
| `DELETE` | `/api/v1/tenants/:tenantId/consent` | Revoke a consent record |

### Maintenance

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/maintenance/purge-expired` | Purge expired audit logs, webhook events, and deliveries |

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

**Validation:**
- `name`: required, 1-255 characters
- `slug`: required, must match `^[a-z][a-z0-9_]{0,62}$`, must be unique
- `parent_id`: optional UUID, must reference an active tenant
- `isolation_strategy`: must be `"SHARED_RLS"` (v1)

**Response:** `201 Created` — returns the tenant object.

### Get Tenant

```
GET /api/v1/tenants/:id
```

**Response:** `200 OK` — returns the tenant object. Returns `404` if not found, `410` if archived.

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

Soft-deletes the tenant (sets `status = 'archived'`). Fails with `409` if the tenant has active children.

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

Moves the tenant (and all descendants) under a new parent. Performs cycle detection — returns `409` if the move would create a cycle.

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

**Response:** `200 OK` — returns all descendants (uses ltree `<@` for efficient subtree query).

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

Fails with `409` if the permission key is locked by an ancestor.

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

:::warning
The `plaintext_key` is only returned in this response. It cannot be retrieved again.
:::

### Revoke API Key

```
DELETE /api/v1/api-keys/:id
```

**Response:** `204 No Content`

---

## Webhook Endpoints

### Register Webhook

```
POST /api/v1/webhooks
```

**Body:**

```json
{
  "url": "https://your-app.example.com/webhooks/stratum",
  "secret": "your-signing-secret",
  "events": ["tenant.created", "tenant.updated", "tenant.deleted"],
  "tenant_id": "uuid (optional — scope to a specific tenant subtree)"
}
```

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | Yes | HTTPS URL to receive POST callbacks |
| `secret` | string | Yes | Signing secret for HMAC-SHA256 verification |
| `events` | string[] | Yes | Event types to subscribe to (use `["*"]` for all) |
| `tenant_id` | UUID | No | Scope events to this tenant and its descendants |

**Response:** `201 Created`

```json
{
  "id": "uuid",
  "url": "https://your-app.example.com/webhooks/stratum",
  "events": ["tenant.created", "tenant.updated", "tenant.deleted"],
  "tenant_id": null,
  "active": true,
  "created_at": "2024-01-01T00:00:00.000Z"
}
```

### List Webhooks

```
GET /api/v1/webhooks
```

**Response:** `200 OK` — array of webhook objects (secret omitted).

### Get Webhook

```
GET /api/v1/webhooks/:id
```

**Response:** `200 OK` — webhook object. Returns `404` if not found.

### Update Webhook

```
PATCH /api/v1/webhooks/:id
```

**Body** (all fields optional):

```json
{
  "url": "https://new-url.example.com/webhooks",
  "events": ["tenant.created"],
  "active": false
}
```

**Response:** `200 OK` — updated webhook object.

### Delete Webhook

```
DELETE /api/v1/webhooks/:id
```

**Response:** `204 No Content`

### List Deliveries

```
GET /api/v1/webhooks/:id/deliveries
```

Returns the delivery history for a webhook, including status, response code, and retry attempts.

**Response:** `200 OK`

```json
{
  "data": [
    {
      "id": "uuid",
      "webhook_id": "uuid",
      "event_type": "tenant.created",
      "status": "delivered",
      "response_status": 200,
      "attempt_count": 1,
      "next_retry_at": null,
      "created_at": "2024-01-01T00:00:00.000Z",
      "delivered_at": "2024-01-01T00:00:00.001Z"
    }
  ]
}
```

**Delivery Status Values:**

| Status | Description |
|--------|-------------|
| `pending` | Queued, not yet attempted |
| `delivered` | Successfully delivered (2xx response) |
| `failed` | All retry attempts exhausted |
| `retrying` | Awaiting next retry attempt |

### Send Test Event

```
POST /api/v1/webhooks/:id/test
```

Sends a synthetic `webhook.test` event to the registered URL. Useful for validating endpoint configuration.

**Response:** `200 OK`

```json
{
  "delivery_id": "uuid",
  "status": "delivered",
  "response_status": 200
}
```

---

## Audit Log Endpoints

### List Audit Logs

```
GET /api/v1/audit-logs?tenant_id=<uuid>&action=<string>&from=<date>&to=<date>&cursor=<uuid>&limit=50
```

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `tenant_id` | UUID | — | Filter by tenant |
| `action` | string | — | Filter by action (e.g. `tenant.created`, `config.updated`) |
| `from` | ISO date | — | Start of date range |
| `to` | ISO date | — | End of date range |
| `cursor` | UUID | — | Cursor for pagination |
| `limit` | number | 50 | Max results (1-100) |

**Response:** `200 OK`

```json
{
  "data": [
    {
      "id": "uuid",
      "tenant_id": "uuid",
      "actor_type": "api_key",
      "actor_id": "uuid",
      "action": "tenant.created",
      "resource_type": "tenant",
      "resource_id": "uuid",
      "before": null,
      "after": { "name": "Acme Corp", "slug": "acme_corp" },
      "created_at": "2024-01-01T00:00:00.000Z"
    }
  ],
  "next_cursor": "uuid | null",
  "has_more": false
}
```

### Get Audit Log Entry

```
GET /api/v1/audit-logs/:id
```

**Response:** `200 OK` — returns the audit log entry object. Returns `404` if not found.

---

## Region Endpoints

### Create Region

```
POST /api/v1/regions
```

**Body:**

```json
{
  "slug": "us_east",
  "display_name": "US East",
  "control_plane_url": "https://us-east.stratum.example.com",
  "status": "active"
}
```

**Response:** `201 Created` — returns the region object.

### List Regions

```
GET /api/v1/regions
```

**Response:** `200 OK` — array of region objects.

### Get Region

```
GET /api/v1/regions/:id
```

**Response:** `200 OK` — returns the region object. Returns `404` if not found.

### Update Region

```
PATCH /api/v1/regions/:id
```

**Body** (all fields optional):

```json
{
  "display_name": "US East (Primary)",
  "status": "draining"
}
```

**Response:** `200 OK` — returns the updated region.

### Delete Region

```
DELETE /api/v1/regions/:id
```

Fails with `409` if the region still has assigned tenants.

**Response:** `204 No Content`

### Migrate Tenant Region

```
POST /api/v1/tenants/:id/migrate-region
```

**Body:**

```json
{
  "region_id": "uuid"
}
```

Moves the tenant to a different region. The tenant's `region_id` is updated.

**Response:** `200 OK` — returns the updated tenant.

---

## Consent Endpoints

### Create Consent Record

```
POST /api/v1/tenants/:tenantId/consent
```

**Body:**

```json
{
  "subject_id": "user-123",
  "purpose": "marketing_emails",
  "expires_at": "2025-12-31T23:59:59.000Z (optional)"
}
```

**Response:** `201 Created`

```json
{
  "id": "uuid",
  "tenant_id": "uuid",
  "subject_id": "user-123",
  "purpose": "marketing_emails",
  "status": "granted",
  "expires_at": "2025-12-31T23:59:59.000Z",
  "created_at": "2024-01-01T00:00:00.000Z"
}
```

### List Consent Records

```
GET /api/v1/tenants/:tenantId/consent
```

**Response:** `200 OK` — array of consent records for the tenant.

### Revoke Consent

```
DELETE /api/v1/tenants/:tenantId/consent
```

**Body:**

```json
{
  "subject_id": "user-123",
  "purpose": "marketing_emails"
}
```

Sets the consent record status to `revoked`.

**Response:** `204 No Content`

---

## GDPR Endpoints

### Purge Tenant Data

```
POST /api/v1/tenants/:id/purge
```

Hard-deletes all data associated with the tenant (GDPR Article 17 — right to erasure). This is irreversible.

**Response:** `204 No Content`

### Export Tenant Data

```
GET /api/v1/tenants/:id/export
```

Exports all tenant data as a JSON document (GDPR Article 20 — data portability).

**Response:** `200 OK` — JSON object containing all tenant data (tenant record, config, permissions, audit logs, consent records).

---

## Maintenance Endpoints

### Purge Expired Records

```
POST /api/v1/maintenance/purge-expired
```

Purges old `audit_logs`, `webhook_events`, and `webhook_deliveries` records older than the configured retention period (default: 90 days).

**Body** (optional):

```json
{
  "retention_days": 90
}
```

**Response:** `200 OK`

```json
{
  "purged": {
    "audit_logs": 1234,
    "webhook_events": 567,
    "webhook_deliveries": 890
  }
}
```

---

## API Key Management Endpoints

### List API Keys

```
GET /api/v1/api-keys?tenant_id=<uuid>
```

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `tenant_id` | UUID | — | Filter by tenant (optional) |

**Response:** `200 OK` — array of API key objects (secrets omitted).

### Rotate API Key

```
POST /api/v1/api-keys/:id/rotate
```

Atomically creates a new API key and revokes the old one. The new plaintext key is returned once.

**Response:** `201 Created`

```json
{
  "id": "uuid",
  "tenant_id": "uuid",
  "key_prefix": "sk_live_xyz",
  "name": "my-service",
  "scopes": ["read", "write"],
  "expires_at": null,
  "created_at": "2024-01-01T00:00:00.000Z",
  "plaintext_key": "sk_live_xyz789...",
  "revoked_key_id": "uuid"
}
```

### List Dormant Keys

```
GET /api/v1/api-keys/dormant
```

Returns API keys that have not been used in over 90 days.

**Response:** `200 OK` — array of API key objects with `last_used_at` field.
