---
sidebar_position: 9
title: Audit Logging
---

# Audit Logging

Every mutation in Stratum records an audit entry with actor identity, resource tracking, and before/after state. Audit logs provide a tamper-evident trail for compliance, debugging, and forensic analysis.

## Audit Context

Every request that modifies data carries an `AuditContext` that identifies who performed the action:

| Field | Description |
|-------|-------------|
| `actor_id` | The identity performing the action (user ID, API key ID, or `system`) |
| `actor_type` | One of `api_key`, `jwt`, or `system` |
| `source_ip` | The originating IP address |
| `request_id` | A unique identifier for the HTTP request |

The context is automatically populated from the incoming request headers and authentication credentials.

---

## Audit Entry Fields

Each audit log entry contains the full context of the change:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `uuid` | Unique entry identifier |
| `actor_id` | `string` | Who performed the action |
| `actor_type` | `string` | `api_key`, `jwt`, or `system` |
| `action` | `string` | The operation performed (e.g. `tenant.created`) |
| `resource_type` | `string` | The type of resource affected (e.g. `tenant`, `config`) |
| `resource_id` | `string` | The ID of the affected resource |
| `tenant_id` | `uuid` | The tenant scope of the action |
| `source_ip` | `string` | Originating IP address |
| `request_id` | `string` | Correlating request identifier |
| `before_state` | `jsonb` | Resource state before the change (null for creates) |
| `after_state` | `jsonb` | Resource state after the change (null for deletes) |
| `metadata` | `jsonb` | Additional context (optional) |
| `created_at` | `timestamptz` | When the entry was recorded |

---

## REST API

### List Audit Logs

```bash
curl "http://localhost:3001/api/v1/audit-logs?tenant_id=TENANT_UUID&action=tenant.created&from=2024-01-01T00:00:00Z&to=2024-12-31T23:59:59Z&limit=50" \
  -H "X-API-Key: sk_live_..."
```

Supported query parameters:

| Parameter | Description |
|-----------|-------------|
| `tenant_id` | Filter by tenant |
| `action` | Filter by action type |
| `resource_type` | Filter by resource type |
| `from` | Start of time range (ISO 8601) |
| `to` | End of time range (ISO 8601) |
| `cursor` | Pagination cursor from previous response |
| `limit` | Maximum entries to return (default 50) |

### Get a Single Entry

```bash
curl http://localhost:3001/api/v1/audit-logs/ENTRY_UUID \
  -H "X-API-Key: sk_live_..."
```

---

## SDK Usage

```typescript
import { stratum } from "@stratum/sdk";

const s = stratum({
  controlPlaneUrl: "http://localhost:3001",
  apiKey: "sk_live_...",
});

// Query audit logs with filters
const logs = await s.queryAuditLogs({
  tenant_id: "TENANT_UUID",
  action: "tenant.created",
  from: "2024-01-01T00:00:00Z",
  limit: 25,
});

for (const entry of logs.data) {
  console.log(`${entry.action} by ${entry.actor_id} at ${entry.created_at}`);
}

// Fetch a single audit entry by ID
const entry = await s.getAuditEntry("ENTRY_UUID");
console.log(entry.before_state, "->", entry.after_state);
```

---

## Querying Examples

### Find all config changes for a tenant

```typescript
const configChanges = await s.queryAuditLogs({
  tenant_id: "TENANT_UUID",
  resource_type: "config",
});
```

### Find all actions by a specific API key

```typescript
const keyActions = await s.queryAuditLogs({
  action: "api_key.created",
  from: "2024-06-01T00:00:00Z",
  to: "2024-06-30T23:59:59Z",
});
```

### Paginate through results

```typescript
let cursor: string | undefined;

do {
  const page = await s.queryAuditLogs({
    tenant_id: "TENANT_UUID",
    cursor,
    limit: 100,
  });

  for (const entry of page.data) {
    console.log(entry.action, entry.resource_id);
  }

  cursor = page.next_cursor;
} while (cursor);
```

---

## Important Notes

:::warning
Audit writes are **synchronous** — the mutation will fail if the audit entry cannot be recorded. This guarantees a complete audit trail but means audit table availability is critical to system operation.
:::

This behavior is distinct from webhook events, which are fire-and-forget and do not block the originating request. If you need non-blocking notifications, use [Webhooks](./webhooks.md) instead.

---

## Access Control

Audit log endpoints require the `admin` scope. API keys with only `read` or `write` scopes cannot access audit data. See [Authorization & Scopes](./authorization.md) for details.
