# GDPR & Data Retention

Stratum provides built-in compliance tooling for GDPR Article 17 (Right to Erasure) and Article 20 (Right to Data Portability), plus configurable data retention policies.

## Data Export (Article 20)

Export all data belonging to a tenant as a structured JSON object:

### Via the API

```bash
curl http://localhost:3001/api/v1/tenants/TENANT_UUID/export \
  -H "X-API-Key: YOUR_ADMIN_KEY"
```

### Via the Library

```typescript
const archive = await stratum.exportTenantData("tenant-uuid");
```

### Exported Data

The export includes all tenant-scoped records:

```json
{
  "tenant": { "id": "...", "name": "Acme Corp", "slug": "acme_corp", "..." },
  "config_entries": [ ... ],
  "permission_policies": [ ... ],
  "api_keys": [ ... ],
  "webhooks": [ ... ],
  "webhook_events": [ ... ],
  "webhook_deliveries": [ ... ],
  "audit_logs": [ ... ],
  "consent_records": [ ... ]
}
```

API keys are exported without plaintext secrets (only metadata: ID, name, created/revoked timestamps).

## Tenant Purge (Article 17)

Hard-delete **all** data belonging to a tenant. This is irreversible.

### Via the API

```bash
curl -X POST http://localhost:3001/api/v1/tenants/TENANT_UUID/purge \
  -H "X-API-Key: YOUR_ADMIN_KEY"
```

### Via the Library

```typescript
await stratum.purgeTenant("tenant-uuid");
```

### Deletion Order

Data is deleted in FK-safe order to prevent constraint violations:

1. `config_entries`
2. `permission_policies`
3. `api_keys`
4. `webhook_deliveries` (via webhook FK join)
5. `webhook_events`
6. `webhooks`
7. `audit_logs`
8. `consent_records` (via `ON DELETE CASCADE`)
9. `tenants` (the tenant record itself)

### Hierarchical Constraint

A tenant with active children **cannot** be purged. You must purge children first:

```
Error 409: Cannot purge tenant abc123: has 2 child tenant(s). Purge children first.
```

To purge an entire subtree, work leaf-to-root:

```typescript
// Purge children first
await stratum.purgeTenant("child-1");
await stratum.purgeTenant("child-2");
// Then the parent
await stratum.purgeTenant("parent");
```

## Data Retention

Automatically purge expired records older than a configurable retention period.

### Via the API

```bash
# Purge records older than 90 days (default)
curl -X POST http://localhost:3001/api/v1/maintenance/purge-expired \
  -H "X-API-Key: YOUR_ADMIN_KEY"

# Custom retention period
curl -X POST "http://localhost:3001/api/v1/maintenance/purge-expired?retention_days=180" \
  -H "X-API-Key: YOUR_ADMIN_KEY"
```

### Via the Library

```typescript
const result = await stratum.purgeExpiredData(90);
console.log(`Deleted ${result.deleted_count} expired records`);
```

### What Gets Purged

Records older than the retention cutoff date:

| Table | Records Deleted |
|-------|-----------------|
| `webhook_deliveries` | Deliveries older than cutoff (deleted first, FK dependency) |
| `webhook_events` | Events older than cutoff |
| `audit_logs` | Logs older than cutoff |

Tenant records, config entries, and permissions are **not** affected by retention purges — only transactional/log data.

### Retention Limits

- Default: 90 days
- Maximum: 3,650 days (10 years)
- Invalid values (NaN, negative) fall back to the default

## Authorization

All GDPR operations require the `admin` scope:

- `GET /api/v1/tenants/:id/export` — admin
- `POST /api/v1/tenants/:id/purge` — admin
- `POST /api/v1/maintenance/purge-expired` — admin

## Recommended Workflow

1. **Export** the tenant's data and deliver it to the data subject
2. **Archive** the tenant first (`DELETE /api/v1/tenants/:id`) for a grace period
3. **Purge** after the grace period expires (`POST /api/v1/tenants/:id/purge`)
4. Set up a **scheduled job** to call `purge-expired` periodically for log retention
