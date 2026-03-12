# Audit Logging

Every mutation in Stratum is recorded with full actor context, resource tracking, and before/after state snapshots.

## How It Works

When you create, update, move, or delete a tenant (or modify config/permissions), an audit entry is automatically written to the `audit_logs` table. Each entry captures:

- **Who** — actor ID and type (API key, JWT, or system)
- **What** — action, resource type, resource ID
- **Where** — tenant ID, source IP, request ID
- **Before/After** — full state snapshots for change tracking

## Querying Audit Logs

### Via the API

```bash
# List all audit logs (paginated)
curl http://localhost:3001/api/v1/audit-logs \
  -H "X-API-Key: YOUR_ADMIN_KEY"

# Filter by tenant
curl "http://localhost:3001/api/v1/audit-logs?tenant_id=TENANT_UUID" \
  -H "X-API-Key: YOUR_ADMIN_KEY"

# Filter by action and date range
curl "http://localhost:3001/api/v1/audit-logs?action=tenant.created&from=2024-01-01T00:00:00Z&to=2024-12-31T23:59:59Z" \
  -H "X-API-Key: YOUR_ADMIN_KEY"

# Get a single audit entry
curl http://localhost:3001/api/v1/audit-logs/ENTRY_UUID \
  -H "X-API-Key: YOUR_ADMIN_KEY"
```

**Query Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `tenant_id` | UUID | Filter by tenant |
| `action` | string | Filter by action (e.g., `tenant.created`) |
| `resource_type` | string | Filter by resource type (e.g., `tenant`, `config`) |
| `actor_id` | string | Filter by actor |
| `from` | ISO 8601 | Start of date range |
| `to` | ISO 8601 | End of date range |
| `limit` | number | Max results, 1-100 (default: 50) |
| `cursor` | UUID | Cursor for keyset pagination |

### Via the Library

```typescript
import { Stratum } from "@stratum/lib";

const logs = await stratum.queryAuditLogs({
  tenant_id: "tenant-uuid",
  action: "config.updated",
  from: "2024-01-01T00:00:00Z",
  limit: 25,
});
```

## Audit Entry Shape

```json
{
  "id": "uuid",
  "actor_id": "user-123",
  "actor_type": "api_key",
  "action": "tenant.created",
  "resource_type": "tenant",
  "resource_id": "uuid",
  "tenant_id": "uuid",
  "source_ip": "10.0.0.1",
  "request_id": "req-uuid",
  "before_state": null,
  "after_state": {
    "name": "Acme Corp",
    "slug": "acme_corp",
    "status": "active"
  },
  "metadata": {},
  "created_at": "2024-01-15T10:30:00.000Z"
}
```

## Actor Types

| Type | Source |
|------|--------|
| `api_key` | Request authenticated via `X-API-Key` header |
| `jwt` | Request authenticated via `Authorization: Bearer` token |
| `system` | Internal operations (migrations, scheduled tasks) |

## Tracked Actions

| Action | Trigger |
|--------|---------|
| `tenant.created` | New tenant created |
| `tenant.updated` | Tenant properties modified |
| `tenant.deleted` | Tenant archived (soft delete) |
| `tenant.moved` | Tenant moved in hierarchy |
| `config.updated` | Config key set or overridden |
| `config.deleted` | Config key removed |
| `permission.created` | Permission policy created |
| `permission.updated` | Permission policy modified |
| `permission.deleted` | Permission policy removed |

## Authorization

Audit log endpoints require the `admin` scope. Keys with `read` or `write` scopes cannot access audit data.

## Pagination

Results are ordered by `created_at DESC, id DESC` and use cursor-based (keyset) pagination:

```bash
# First page
curl "http://localhost:3001/api/v1/audit-logs?limit=10"

# Next page (use the last entry's ID as cursor)
curl "http://localhost:3001/api/v1/audit-logs?limit=10&cursor=LAST_ENTRY_ID"
```

## Retention

Audit logs are subject to the data retention policy. By default, logs older than 90 days are eligible for purging via `POST /api/v1/maintenance/purge-expired`. See the [GDPR & Data Retention](gdpr.md) guide for details.
