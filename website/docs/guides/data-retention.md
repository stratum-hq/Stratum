---
sidebar_position: 11
title: Data Retention & GDPR
---

# Data Retention & GDPR

Stratum provides built-in support for GDPR Article 17 (right to erasure) and Article 20 (data portability). These endpoints allow you to purge tenant data, export it in a structured format, and clean up expired records.

## Tenant Purge

Hard-delete **all** data belonging to a tenant in foreign-key-safe order. This is an irreversible operation.

### Via REST API

```bash
curl -X POST http://localhost:3001/api/v1/tenants/TENANT_UUID/purge \
  -H "X-API-Key: sk_live_..."
```

### Via SDK

```typescript
import { stratum } from "@stratum/sdk";

const s = stratum({
  controlPlaneUrl: "http://localhost:3001",
  apiKey: "sk_live_...",
});

await s.purgeTenant("TENANT_UUID");
```

### What Gets Purged

Data is deleted in the following order to respect foreign key constraints:

1. `config_entries`
2. `permission_policies`
3. `api_keys`
4. `webhook_deliveries`
5. `webhook_events`
6. `webhooks`
7. `audit_logs`
8. `tenants`

:::danger
Purge is **irreversible**. An audit entry is created *before* the purge begins so that a compliance trail exists even after the tenant data is gone.
:::

---

## Tenant Export

Export all data belonging to a tenant as structured JSON, suitable for data portability requests.

### Via REST API

```bash
curl http://localhost:3001/api/v1/tenants/TENANT_UUID/export \
  -H "X-API-Key: sk_live_..." \
  -o tenant-export.json
```

### Via SDK

```typescript
const data = await s.exportTenantData("TENANT_UUID");

console.log(data.tenant);         // Tenant record
console.log(data.config_entries);  // All config key-value pairs
console.log(data.permissions);     // Permission policies
console.log(data.webhooks);        // Webhook registrations
console.log(data.audit_logs);      // Audit history
```

The export includes all data associated with the tenant across every table. Sensitive fields (webhook secrets, encrypted config values) are excluded from the export.

---

## Expired Data Purge

Remove soft-deleted tenants and associated data that have been archived longer than a specified retention period.

### Via REST API

```bash
curl -X POST "http://localhost:3001/api/v1/maintenance/purge-expired?retention_days=90" \
  -H "X-API-Key: sk_live_..."
```

The `retention_days` parameter specifies how many days after soft-deletion a record becomes eligible for hard-delete. Records deleted fewer than `retention_days` ago are left untouched.

### Via SDK

```typescript
const result = await s.purgeExpiredData(90);

console.log(result.purged_count); // Number of tenants purged
```

### What Gets Purged

The same set of tables as tenant purge, but only for tenants where:
- `status` is `deleted`
- `deleted_at` is older than the retention threshold

---

## Combining Purge and Export

A common GDPR workflow is to export data before purging:

```typescript
// 1. Export for the data subject
const exportData = await s.exportTenantData("TENANT_UUID");
await saveToSecureStorage(exportData);

// 2. Purge the tenant
await s.purgeTenant("TENANT_UUID");

// 3. Confirm purge via audit log
const auditLogs = await s.queryAuditLogs({
  resource_id: "TENANT_UUID",
  action: "tenant.purged",
});
console.log("Purge recorded at:", auditLogs.data[0].created_at);
```

---

## Access Control

All data retention endpoints require the `admin` scope. See [Authorization & Scopes](./authorization.md) for details on scope management.

---

## Scheduling Automated Purges

Stratum does not include a built-in scheduler. Run expired data purges on a cron schedule:

```bash
# Purge tenants deleted more than 90 days ago, daily at midnight
0 0 * * * curl -X POST "http://localhost:3001/api/v1/maintenance/purge-expired?retention_days=90" \
  -H "X-API-Key: sk_live_admin_key"
```

For production deployments, wrap this in a monitoring job that alerts on failure.
